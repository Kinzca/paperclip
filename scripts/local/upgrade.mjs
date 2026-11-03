import fs from "node:fs";
import path from "node:path";
import { root, localDir, env, port, runNode } from "./common.mjs";
import {
  assertNode,
  assertStopped,
  lock,
  current,
  verifyRelease,
  assertTransition,
  json,
  writeJson,
  copy,
  sha,
} from "./release-lib.mjs";

export async function activate({ to, rollback = false }) {
  assertNode();
  await assertStopped(port);
  const unlock = lock(localDir);
  try {
    const state = current(localDir);
    const selected = to || (rollback ? state.previous : null);
    if (!selected)
      throw new Error(
        "请指定 --to <版本>，或使用 rollback.mjs 回到已记录的上一版本。",
      );
    const pendingFile = path.join(localDir, "pending-deployment.json");
    const pending = fs.existsSync(pendingFile) ? json(pendingFile) : null;
    if (selected === state.release) {
      if (pending?.to === state.release && pending.from === state.previous) {
        verifyRelease(localDir, state.release);
        writeJson(path.join(pending.checkpoint, "deployment.json"), {
          from: pending.from,
          to: pending.to,
          rollback: pending.rollback,
          phase: "activated",
          acceptance: "pending-user",
        });
        fs.unlinkSync(pendingFile);
        console.log("版本指针已完成切换，已补齐中断的部署记录；请启动服务。");
        return;
      }
      throw new Error("已经是该版本，没有执行切换。");
    }
    const from = verifyRelease(localDir, state.release);
    const target = verifyRelease(localDir, selected);
    assertTransition(
      { ...from.manifest, migrations: state.databaseLedger },
      target.manifest,
      rollback,
    );
    if (
      pending &&
      (pending.to !== selected ||
        pending.from !== state.release ||
        pending.rollback !== rollback)
    )
      throw new Error(
        "存在其他未完成部署，请先处理 pending-deployment.json 中的操作。",
      );
    const checkpoint =
      pending?.checkpoint ||
      path.join(
        localDir,
        "checkpoints",
        `${Date.now()}-${state.release}-to-${selected}`,
      );
    fs.mkdirSync(checkpoint, { recursive: true, mode: 0o700 });
    if (!pending) {
      for (const name of Object.keys(target.manifest.plugins)) {
        const folder =
          state.pluginPaths[name] || path.join(localDir, "plugins", name);
        if (
          !from.manifest.plugins[name] &&
          fs.existsSync(folder) &&
          fs.readdirSync(folder).length
        )
          throw new Error(`新增插件目标已存在，请保留现场：${folder}`);
      }
      // 只管理发布清单内的文件；其他知识文件和用户源码不清除。
      for (const name of Object.keys(from.manifest.plugins)) {
        for (const [relative, hash] of Object.entries(
          from.manifest.plugins[name].files,
        )) {
          const file = path.join(state.pluginPaths[name], relative);
          if (!fs.existsSync(file) || sha(file) !== hash)
            throw new Error(
              `已安装插件有未记录改动：${name}/${relative}，请保留后处理。`,
            );
        }
      }
      runNode([
        path.join(root, "scripts/local/database.mjs"),
        from.runtime,
        "inspect",
        checkpoint,
      ]);
      runNode([
        path.join(root, "scripts/local/database.mjs"),
        from.runtime,
        "backup",
        checkpoint,
      ]);
      copy(env.PAPERCLIP_CONFIG, path.join(checkpoint, "config.json"));
      fs.chmodSync(path.join(checkpoint, "config.json"), 0o600);
      writeJson(path.join(checkpoint, "current-before.json"), state);
      for (const name of Object.keys(from.manifest.plugins))
        copy(
          path.join(from.directory, "plugins", name),
          path.join(checkpoint, "plugins", name),
        );
      writeJson(pendingFile, {
        from: state.release,
        to: selected,
        checkpoint,
        rollback,
        phase: "migration",
      });
    }
    runNode([
      path.join(root, "scripts/local/database.mjs"),
      target.runtime,
      "migrate",
      checkpoint,
    ]);
    writeJson(pendingFile, {
      from: state.release,
      to: selected,
      checkpoint,
      rollback,
      phase: "plugins",
    });
    const pluginPaths = Object.fromEntries(
      Object.keys(target.manifest.plugins).map((name) => [
        name,
        state.pluginPaths[name] || path.join(localDir, "plugins", name),
      ]),
    );
    for (const name of Object.keys(target.manifest.plugins)) {
      const folder = pluginPaths[name];
      for (const relative of Object.keys(
        from.manifest.plugins[name]?.files || {},
      )) {
        if (!(relative in target.manifest.plugins[name].files))
          fs.rmSync(path.join(folder, relative), { force: true });
      }
      copy(path.join(target.directory, "plugins", name), folder);
    }
    const next = {
      ...state,
      release: selected,
      pluginPaths,
      previous: state.release,
      databaseLedger: target.manifest.migrations,
      checkpoint,
      firstStart: false,
      pluginsPendingSync: true,
      activatedAt: new Date().toISOString(),
    };
    writeJson(path.join(localDir, "current.json"), next);
    writeJson(path.join(checkpoint, "deployment.json"), {
      from: state.release,
      to: selected,
      rollback,
      phase: "activated",
      acceptance: "pending-user",
    });
    fs.unlinkSync(pendingFile);
    console.log(
      `已${rollback ? "回退" : "切换"}到 ${selected}，备份：${checkpoint}\n请执行 node scripts/local/start.mjs；启动会通过正式接口同步已安装的 托管插件，未安装插件仍需显式登记。`,
    );
  } finally {
    unlock();
  }
}
const calledDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.join(root, "scripts/local/upgrade.mjs");
if (calledDirectly) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help")
    console.log(
      "先停止服务，再执行 node scripts/local/upgrade.mjs --to <已构建版本>。备份成功后迁移、切换；失败保留 checkpoint 与 pending-deployment.json，处理原因后可对同一版本重试。",
    );
  else {
    if (args.length !== 2 || args[0] !== "--to")
      throw new Error("用法：upgrade.mjs --to <版本>");
    await activate({ to: args[1] });
  }
}
