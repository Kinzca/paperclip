import { describe, expect, it } from "vitest";
import { localMcpToolReadiness } from "./local-mcp-readiness.js";

describe("local MCP configuration admission", () => {
  const config = { extraArgs: ["-c", "mcp_servers.editor.enabled=true", "-c",
    'mcp_servers.editor.tools.inspect.approval_mode="approve"'] };
  it("requires exact approval without granting sibling tools or changing sandbox policy", () => {
    expect(localMcpToolReadiness("codex_local", config, "editor", "inspect")).toBeNull();
    expect(localMcpToolReadiness("codex_local", config, "editor", "execute")).toMatch(/approval/);
    expect(localMcpToolReadiness("codex_local", {}, "editor", "inspect")).toMatch(/enablement/);
  });
  it("honors explicit exclusion and last override", () => {
    for (const override of ['mcp_servers.editor.enabled=false',
      'mcp_servers.editor.disabled_tools=["inspect"]', 'mcp_servers.editor.enabled_tools=["other"]']) {
      expect(localMcpToolReadiness("codex_local", { extraArgs: [...config.extraArgs, `--config=${override}`] }, "editor", "inspect")).not.toBeNull();
    }
  });
  it("reports malformed or unknown configuration instead of claiming readiness", () => {
    expect(localMcpToolReadiness("process", config, "editor", "inspect")).toMatch(/not supported/);
    expect(localMcpToolReadiness("codex_local", { extraArgs: [1] }, "editor", "inspect")).toMatch(/invalid/);
    expect(localMcpToolReadiness("codex_local", { extraArgs: [...config.extraArgs, "-c", "mcp_servers.editor.enabled_tools=oops"] }, "editor", "inspect")).toMatch(/string array/);
  });
});
