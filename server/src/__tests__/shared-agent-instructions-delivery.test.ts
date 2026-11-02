import { access } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "../adapters/types.js";
import { execute as executeProcess } from "../adapters/process/execute.js";
import { execute as executeHttp } from "../adapters/http/execute.js";

const remoteFetch = vi.hoisted(() => vi.fn());
vi.mock("../adapters/http/remote-fetch.js", () => ({ guardedHttpAdapterFetch: remoteFetch }));

const context = (config: Record<string, unknown>, instructions: string): AdapterExecutionContext => ({
  runId: `shared-instructions-${crypto.randomUUID()}`,
  agent: { id: "agent", companyId: "studio-a", name: "Process", adapterType: "process", adapterConfig: {} },
  runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
  config, context: { paperclipWake: { sharedAgentInstructions: instructions } }, onLog: async () => {},
});

describe("shared instructions adapter delivery", () => {
  it("delivers long UTF-8 instructions to a real child, replaces configured paths, and removes the temporary file", async () => {
    const instructions = "全局规则与工作室规范\n".repeat(4000);
    const result = await executeProcess(context({
      command: process.execPath,
      args: ["-e", "const fs=require('node:fs');const file=process.env.PAPERCLIP_SHARED_AGENT_INSTRUCTIONS_FILE;console.log(JSON.stringify({file,text:fs.readFileSync(file,'utf8')}))"],
      env: { PAPERCLIP_SHARED_AGENT_INSTRUCTIONS_FILE: "/forged" },
    }, instructions));
    expect(result.exitCode).toBe(0);
    const received = JSON.parse(String(result.resultJson?.stdout));
    expect(received.text).toBe(instructions);
    await expect(access(received.file)).rejects.toThrow();
  });

  it("clears configured file paths when instructions are empty", async () => {
    const result = await executeProcess(context({
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify(process.env.PAPERCLIP_SHARED_AGENT_INSTRUCTIONS_FILE))"],
      env: { PAPERCLIP_SHARED_AGENT_INSTRUCTIONS_FILE: "/forged" },
    }, ""));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(String(result.resultJson?.stdout))).toBe("");
  });

  it("sends current guidance to HTTP adapters instead of the payload template's forged value", async () => {
    remoteFetch.mockResolvedValue(new Response("ok"));
    await executeHttp(context({ url: "https://example.com/agent", payloadTemplate: { sharedAgentInstructions: "forged" } }, "CURRENT_GUIDANCE"));
    const body = JSON.parse(remoteFetch.mock.calls.at(-1)![1].body);
    expect(body.sharedAgentInstructions).toBe("CURRENT_GUIDANCE");
    expect(body.context.paperclipWake.sharedAgentInstructions).toBe("CURRENT_GUIDANCE");
  });
});
