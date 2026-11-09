import { z } from "zod";

const configSchema = z.object({
  extraArgs: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
});

/** Conservative configuration proof, not a live probe or a permission grant.
 * Only exact explicit overrides are accepted. Inherited home config remains unknown.
 */
export function localMcpToolReadiness(adapterType: string, adapterConfig: unknown,
  server: string, tool: string): string | null {
  if (adapterType !== "codex_local") return "local MCP preflight is not supported by this adapter";
  const parsed = configSchema.safeParse(adapterConfig);
  if (!parsed.success) return "invalid local adapter argument configuration";
  const args = parsed.data.extraArgs?.length ? parsed.data.extraArgs : parsed.data.args ?? [];
  const settings = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = arg === "-c" || arg === "--config" ? args[++index]
      : arg.startsWith("--config=") ? arg.slice(9) : arg.startsWith("-c=") ? arg.slice(3) : null;
    if (!value) continue;
    const at = value.indexOf("=");
    if (at > 0) settings.set(value.slice(0, at).trim(), value.slice(at + 1).trim());
  }
  const prefix = `mcp_servers.${server}`;
  if (settings.get(`${prefix}.enabled`) !== "true") return "server enablement is not explicitly verified";
  if (settings.get(`${prefix}.tools.${tool}.enabled`) === "false") return "tool is explicitly disabled";
  const mode = settings.get(`${prefix}.tools.${tool}.approval_mode`);
  if (mode !== '"approve"' && mode !== "'approve'") return "exact tool approval is not explicitly verified";
  // An allow-list, when present, must actually expose this tool; disabled wins.
  for (const [key, blocked] of [["enabled_tools", false], ["disabled_tools", true]] as const) {
    const raw = settings.get(`${prefix}.${key}`);
    if (raw === undefined) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return "tool list requires an explicit JSON-compatible string array"; }
    const list = z.array(z.string()).safeParse(value);
    if (!list.success) return "invalid explicit tool list";
    if (blocked ? list.data.includes(tool) : !list.data.includes(tool)) return "tool is excluded by the explicit tool list";
  }
  return null;
}
