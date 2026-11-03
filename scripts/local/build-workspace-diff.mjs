import path from "node:path";
import { createRequire } from "node:module";
import { root, pnpm, runNode } from "./common.mjs";

// 使用仓库锁定依赖构建官方 UI，并将 worker 与匹配的 SDK 打成独立运行包。
runNode([pnpm, "--filter", "@paperclipai/plugin-workspace-diff", "build"]);
const directory = path.join(root, "packages/plugins/plugin-workspace-diff");
const require = createRequire(path.join(directory, "package.json"));
const { build } = require("esbuild");
await build({
  entryPoints: [path.join(directory, "src/worker.ts")],
  outfile: path.join(directory, "dist/worker.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
