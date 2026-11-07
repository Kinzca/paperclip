import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { callLocalStdioMcpProcess } from "./local-stdio-mcp.js";

const server = `
const readline = require("node:readline");
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 5000);
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (!request.id) return;
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n");
    return;
  }
  BODY
});`;

function call(body: string, timeoutMs = 1000) {
  return callLocalStdioMcpProcess({
    command: process.execPath, args: ["-e", server.replace("BODY", body)],
    env: {}, method: "tools/call", params: { name: "fixture" }, timeoutMs,
  });
}

describe("owned local stdio MCP processes", () => {
  it("returns a result and reaps a process that ignores graceful shutdown", async () => {
    const started = Date.now();
    const result = await call('process.stdout.write(JSON.stringify({ id: request.id, result: { pid: process.pid } }) + "\\n");') as { pid: number };
    expect(Date.now() - started).toBeLessThan(3000);
    expect(() => process.kill(result.pid, 0)).toThrow();
  });

  it("bounds a hung call even when the child ignores SIGTERM", async () => {
    const started = Date.now();
    await expect(call("", 400)).rejects.toMatchObject({ status: 504, code: "tool_timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it.skipIf(process.platform === "win32")("bounds cleanup when an exited parent leaves an inherited pipe open", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-stdio-fixture-"));
    const pidFile = path.join(directory, "descendant.pid");
    const started = Date.now();
    try {
      await expect(call(`
        const descendant = require("node:child_process").spawn(process.execPath,
          ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 5000); process.send("ready");'],
          { stdio: ["ignore", 1, 2, "ipc"] });
        descendant.once("message", () => {
          require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));
          process.exit(0);
        });
      `)).rejects.toMatchObject({ code: "local_stdio_process_exited" });
      expect(Date.now() - started).toBeLessThan(3000);
      const pid = Number(await fs.readFile(pidFile, "utf8"));
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["not-json", "null", "[]", '{"id":2}'])("rejects malformed protocol response %s", async (line) => {
    await expect(call(`process.stdout.write(${JSON.stringify(`${line}\n`)});`))
      .rejects.toMatchObject({ code: "local_stdio_protocol_error" });
  });

  it("bounds an unterminated response", async () => {
    await expect(call('process.stdout.write("x".repeat(17 * 1024 * 1024));'))
      .rejects.toMatchObject({ code: "local_stdio_protocol_error" });
  });

  it("reports spawn failure without an unhandled rejection", async () => {
    await expect(callLocalStdioMcpProcess({
      command: "/missing-paperclip-fixture-command", args: [], env: {},
      method: "tools/list", params: {}, timeoutMs: 1000,
    })).rejects.toMatchObject({ code: "local_stdio_spawn_failed" });
  });
});
