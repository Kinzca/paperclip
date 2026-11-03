import fs from "node:fs";
import path from "node:path";
import { root, localDir, env, port, runNode } from "./common.mjs";
import {
  assertNode,
  assertStopped,
  lock,
  current,
  id,
  json,
  writeJson,
  copy,
  copyPlugin,
  pluginInfo,
  migrationLedger,
  files,
} from "./release-lib.mjs";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(
    "用法：adopt.mjs --runtime <原运行目录> --commit <完整提交 SHA> --office <原 Office 包目录> --wiki <原 Wiki 包目录>\n只接管已有、已停止且带准确 build-info.json 的源码部署，复制为可回退版本；不改登录、数据库和原插件路径。",
  );
  process.exit(0);
}
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--runtime", "--commit", "--office", "--wiki"].includes(args[i]) ||
    !args[i + 1] ||
    options[args[i]]
  )
    throw new Error("参数缺失、重复或未知，请使用 --help。");
  options[args[i]] = args[i + 1];
}
for (const key of ["--runtime", "--commit", "--office", "--wiki"])
  if (!options[key]) throw new Error(`缺少 ${key}`);
assertNode();
await assertStopped(port);
const unlock = lock(localDir);
try {
  if (current(localDir, false))
    throw new Error("已经存在托管版本，不重复接管。");
  if (!fs.existsSync(env.PAPERCLIP_CONFIG))
    throw new Error("未发现已有实例配置，请设置正确的 PAPERCLIP_LOCAL_DIR。");
  const commit = id(options["--commit"]);
  if (commit.length !== 40) throw new Error("接管要求完整提交 SHA。");
  const original = fs.realpathSync(options["--runtime"]);
  const stamp = json(
    path.join(
      original,
      "node_modules/@paperclipai/server/dist/build-info.json",
    ),
  );
  if (stamp.commit !== commit)
    throw new Error(
      "后端 build-info.json 与指定提交不符，不能把旧发布包冒充该提交。",
    );
  const releaseId = commit.slice(0, 12);
  const destination = path.join(localDir, "releases", releaseId);
  if (fs.existsSync(destination))
    throw new Error("同提交版本已存在，保留现场，请先核查。");
  const stage = path.join(localDir, "releases", `.adopting-${releaseId}`);
  if (fs.existsSync(stage)) throw new Error(`未完成接管目录已存在：${stage}`);
  fs.mkdirSync(stage, { recursive: true });
  runNode([
    path.join(root, "scripts/local/database.mjs"),
    original,
    "inspect",
    stage,
  ]);
  copy(original, path.join(stage, "runtime"));
  const ui = path.join(
    stage,
    "runtime/node_modules/@paperclipai/server/ui-dist",
  );
  if (fs.lstatSync(ui).isSymbolicLink()) {
    const actual = fs.realpathSync(ui);
    fs.unlinkSync(ui);
    copy(actual, ui);
  }
  const pluginPaths = Object.fromEntries(
    ["office", "wiki"].map((name) => [
      name,
      fs.realpathSync(options[`--${name}`]),
    ]),
  );
  for (const name of ["office", "wiki"])
    copyPlugin(pluginPaths[name], path.join(stage, "plugins", name));
  const runtime = path.join(stage, "runtime");
  const artifacts = {};
  for (const relative of [
    "runtime/node_modules/@paperclipai/server/dist",
    "runtime/node_modules/@paperclipai/server/ui-dist",
    "runtime/node_modules/@paperclipai/shared/dist",
    "runtime/node_modules/@paperclipai/db/dist",
    "runtime/node_modules/@paperclipai/plugin-sdk/dist",
    "plugins/office",
    "plugins/wiki",
  ])
    artifacts[relative] = files(path.join(stage, relative));
  const manifest = {
    schema: 1,
    commit,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    legacy: true,
    builtAt: new Date().toISOString(),
    provenance:
      "用户显式指定且与后端构建戳一致的历史部署；依赖及前端不追认新构建流程",
    migrations: migrationLedger(runtime),
    plugins: Object.fromEntries(
      ["office", "wiki"].map((name) => [
        name,
        pluginInfo(path.join(stage, "plugins", name), name),
      ]),
    ),
    artifacts,
  };
  writeJson(path.join(stage, "release.json"), manifest);
  fs.renameSync(stage, destination);
  writeJson(path.join(localDir, "current.json"), {
    schema: 1,
    release: releaseId,
    previous: null,
    pluginPaths,
    databaseLedger: manifest.migrations,
    firstStart: false,
  });
  console.log(
    `已接管历史部署 ${releaseId}，未迁移数据库或重设登录。请使用 setup --prepare-only 和 upgrade --to 构建并切换统一版本。`,
  );
} finally {
  unlock();
}
