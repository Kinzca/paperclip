import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { current, execute } from "./release-lib.mjs";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const localDir = path.resolve(
  process.env.PAPERCLIP_LOCAL_DIR || path.join(root, ".paperclip-local"),
);
const state = current(localDir, false);
export const runtime = state
  ? path.join(localDir, "releases", state.release, "runtime")
  : path.join(localDir, "runtime");
export const office =
  state?.pluginPaths?.office || path.join(localDir, "plugins/office");
export const wiki =
  state?.pluginPaths?.wiki || path.join(localDir, "plugins/wiki");
export const workspaceDiff =
  state?.pluginPaths?.["workspace-diff"] ||
  path.join(localDir, "plugins/workspace-diff");
export const pnpm = path.join(
  localDir,
  "build-tools/node_modules/pnpm/bin/pnpm.cjs",
);
export const codexCli =
  [
    path.join(
      runtime,
      "node_modules/@paperclipai/server/node_modules/@openai/codex/bin/codex.js",
    ),
    path.join(runtime, "node_modules/@openai/codex/bin/codex.js"),
  ].find(existsSync) ||
  path.join(runtime, "node_modules/@openai/codex/bin/codex.js");
export const codexHome = process.env.CODEX_HOME || path.join(localDir, "codex");
export const sdk = path.join(
  runtime,
  "node_modules/@paperclipai/plugin-sdk/dist",
);
export const cli = path.join(runtime, "node_modules/paperclipai/dist/index.js");
export const port = process.env.PAPERCLIP_PORT || "3100";
export const env = {
  ...process.env,
  PAPERCLIP_HOME: path.join(localDir, "home"),
  PAPERCLIP_CONFIG: path.join(localDir, "home/instances/default/config.json"),
  PAPERCLIP_INSTANCE_ID: "default",
  CODEX_HOME: codexHome,
  PAPERCLIP_TELEMETRY_DISABLED: "1",
  PAPERCLIP_NO_BROWSER: "true",
  PAPERCLIP_OPEN_ON_LISTEN: "false",
  PORT: port,
  npm_config_cache: path.join(localDir, "npm-cache"),
  PATH: [
    path.dirname(process.execPath),
    path.join(localDir, "build-tools/node_modules/.bin"),
    path.join(runtime, "node_modules/.bin"),
    path.join(runtime, "node_modules/@paperclipai/server/node_modules/.bin"),
    process.env.PATH,
  ].join(path.delimiter),
};
delete env.OPENAI_API_KEY;
export function run(command, args, options = {}) {
  return execute(command, args, { cwd: root, env, ...options });
}
export function runNode(args, options) {
  return run(process.execPath, args, options);
}
