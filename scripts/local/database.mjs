// 仅供部署命令在已停止的实例上调用，不打印数据库连接串或密钥。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { json, writeJson } from "./release-lib.mjs";

export async function database(runtime, mode, outputDir) {
  if (
    !process.env.PAPERCLIP_CONFIG ||
    !fs.existsSync(process.env.PAPERCLIP_CONFIG)
  )
    throw new Error(
      "已有实例必须提供存在的 PAPERCLIP_CONFIG，拒绝猜测数据库位置。",
    );
  const root = path.join(runtime, "node_modules/@paperclipai/db/dist");
  const { resolveMigrationConnection } = await import(
    pathToFileURL(path.join(root, "migration-runtime.js")).href
  );
  const { inspectMigrations, applyPendingMigrations } = await import(
    pathToFileURL(path.join(root, "client.js")).href
  );
  const connection = await resolveMigrationConnection();
  try {
    const before = await inspectMigrations(connection.connectionString);
    if (mode === "backup") {
      const { runDatabaseBackup } = await import(
        pathToFileURL(path.join(root, "backup-lib.js")).href
      );
      const result = await runDatabaseBackup({
        connectionString: connection.connectionString,
        backupDir: outputDir,
        retention: { dailyDays: 36500, weeklyWeeks: 5200, monthlyMonths: 1200 },
        filenamePrefix: "before-upgrade",
      });
      if (!result.sizeBytes || !fs.existsSync(result.backupFile))
        throw new Error("数据库备份为空或缺失，停止升级。");
      writeJson(path.join(outputDir, "database-backup.json"), result);
      writeJson(path.join(outputDir, "migration-before.json"), before);
    } else if (mode === "migrate") {
      await applyPendingMigrations(connection.connectionString);
      const after = await inspectMigrations(connection.connectionString);
      writeJson(path.join(outputDir, "migration-after.json"), after);
      if (after.status !== "upToDate")
        throw new Error("迁移未完成，保留停止状态。");
    } else if (mode === "inspect") {
      if (before.status !== "upToDate")
        throw new Error("当前运行包与数据库迁移不一致，请先处理现有部署。");
      writeJson(path.join(outputDir, "database-inspect.json"), before);
    } else throw new Error("未知数据库部署动作。");
  } finally {
    await connection.stop();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const [runtime, mode, outputDir] = process.argv.slice(2);
  await database(path.resolve(runtime), mode, path.resolve(outputDir));
}
