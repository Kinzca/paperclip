import fs from "node:fs";
import path from "node:path";
import { root, localDir, port, runNode } from "./common.mjs";
import {
  assertNode,
  assertStopped,
  lock,
  current,
  verifyRelease,
  writeJson,
} from "./release-lib.mjs";
// 用于恢复到独立实例后的数据库升级；日常升级由 upgrade.mjs 自动调用迁移。
if (process.argv.includes("--help")) {
  console.log(
    "node scripts/local/migrate.mjs：停止服务后，对恢复到独立实例的数据库先备份再迁移。日常升级请用 upgrade.mjs。",
  );
  process.exit(0);
}
if (process.argv.length > 2) throw new Error("migrate.mjs 不接受参数。");
assertNode();
await assertStopped(port);
const unlock = lock(localDir);
try {
  if (fs.existsSync(path.join(localDir, "pending-deployment.json")))
    throw new Error("存在未完成升级，请先重试原 upgrade。");
  const state = current(localDir);
  const target = verifyRelease(localDir, state.release);
  const checkpoint = path.join(
    localDir,
    "checkpoints",
    `${Date.now()}-restored-database`,
  );
  fs.mkdirSync(checkpoint, { recursive: true, mode: 0o700 });
  runNode([
    path.join(root, "scripts/local/database.mjs"),
    target.runtime,
    "backup",
    checkpoint,
  ]);
  runNode([
    path.join(root, "scripts/local/database.mjs"),
    target.runtime,
    "migrate",
    checkpoint,
  ]);
  writeJson(path.join(localDir, "current.json"), {
    ...state,
    databaseLedger: target.manifest.migrations,
    firstStart: false,
    checkpoint,
  });
  console.log(`数据库迁移完成；备份：${checkpoint}。尚未启动服务或验收。`);
} finally {
  unlock();
}
