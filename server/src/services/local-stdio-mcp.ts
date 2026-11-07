import { spawn } from "node:child_process";

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const STOP_GRACE_MS = 250;

export class LocalStdioMcpError extends Error {
  constructor(
    readonly status: 502 | 504,
    message: string,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** One owned process per exchange; neither the RPC nor process cleanup can wait forever. */
export async function callLocalStdioMcpProcess(input: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  const child = spawn(input.command, input.args, {
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let stdout = "";
  let stderr = "";
  let nextId = 1;
  let failure: LocalStdioMcpError | null = null;
  let pending: { id: number; resolve(value: unknown): void; reject(error: Error): void } | null = null;
  const fail = (error: LocalStdioMcpError) => {
    failure ??= error;
    pending?.reject(failure);
    pending = null;
  };
  const stop = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      // An already exited owned process/group needs no further cleanup.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  child.once("error", (error) => fail(new LocalStdioMcpError(
    502, "Local stdio MCP command failed to start", "local_stdio_spawn_failed", { message: error.message },
  )));
  child.once("exit", (code, signal) => fail(new LocalStdioMcpError(
    502, "Local stdio MCP command exited before responding", "local_stdio_process_exited", { code, signal, stderr },
  )));
  child.stdin.on("error", (error) => fail(new LocalStdioMcpError(
    502, "Local stdio MCP input failed", "local_stdio_protocol_error", { message: error.message },
  )));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (failure) return;
    stdout += chunk;
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
        fail(new LocalStdioMcpError(502, "Local stdio MCP response exceeds the size limit", "local_stdio_protocol_error"));
        return;
      }
      if (line) {
        let message: unknown;
        try { message = JSON.parse(line); }
        catch {
          fail(new LocalStdioMcpError(502, "Local stdio MCP server returned invalid JSON", "local_stdio_protocol_error"));
          return;
        }
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          fail(new LocalStdioMcpError(502, "Local stdio MCP server returned an invalid message", "local_stdio_protocol_error"));
          return;
        }
        const response = message as Record<string, unknown>;
        if (pending && response.id === pending.id) {
          if (response.error !== undefined) {
            fail(new LocalStdioMcpError(502, "Local stdio MCP server returned a JSON-RPC error", "local_stdio_protocol_error", { error: response.error }));
            return;
          }
          if (!("result" in response)) {
            fail(new LocalStdioMcpError(502, "Local stdio MCP response is missing its result", "local_stdio_protocol_error"));
            return;
          }
          const waiter = pending;
          pending = null;
          waiter.resolve(response.result);
        }
      }
      newline = stdout.indexOf("\n");
    }
    if (Buffer.byteLength(stdout) > MAX_MESSAGE_BYTES) {
      fail(new LocalStdioMcpError(502, "Local stdio MCP response exceeds the size limit", "local_stdio_protocol_error"));
    }
  });
  const request = (method: string, params: Record<string, unknown>) => {
    if (failure) return Promise.reject(failure);
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      pending = { id, resolve, reject };
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  const timer = setTimeout(() => fail(new LocalStdioMcpError(
    504, "Local stdio MCP tool call timed out", "tool_timeout",
  )), input.timeoutMs);
  try {
    await request("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "paperclip-tool-gateway", version: "0.3.1" },
    });
    if (failure) throw failure;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    return await request(input.method, input.params);
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    stop("SIGTERM");
    // close also waits for inherited pipes. A descendant must not keep the
    // request alive after its parent exits; kill only this owned process group.
    let grace: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([closed, new Promise<void>((resolve) => { grace = setTimeout(resolve, STOP_GRACE_MS); })]);
    clearTimeout(grace);
    stop("SIGKILL");
    await Promise.race([closed, new Promise<void>((resolve) => { grace = setTimeout(resolve, STOP_GRACE_MS); })]);
    clearTimeout(grace);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
}
