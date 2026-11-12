import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { localDir, cli, codexHome, env, root, port } from "./common.mjs";
import {
  assertNode,
  assertStopped,
  lock,
  current,
  verifyRelease,
  writeJson,
  pluginKeys,
  pluginNames,
} from "./release-lib.mjs";
import { registerLocalPlugin } from "./plugin-install.mjs";

assertNode();
await assertStopped(port);
const unlock = lock(localDir);
let child;
try {
  if (fs.existsSync(path.join(localDir, "pending-deployment.json")))
    throw new Error(
      "上次部署未完成，先处理或重试该次 upgrade；不会启动旧代码访问可能已迁移的数据。",
    );
  const state = current(localDir);
  const target = verifyRelease(localDir, state.release);
  if (
    target.manifest.platform !== process.platform ||
    target.manifest.arch !== process.arch
  )
    throw new Error("不能在另一操作系统直接运行此包，请从同一提交重新构建。");
  fs.mkdirSync(codexHome, { recursive: true });
  const first = state.firstStart && !fs.existsSync(env.PAPERCLIP_CONFIG);
  const command = first
    ? cli
    : path.join(
        target.runtime,
        "node_modules/@paperclipai/server/dist/index.js",
      );
  child = spawn(
    process.execPath,
    [command, ...(first ? ["onboard", "--yes", "--no-install-service"] : [])],
    {
      env: {
        ...env,
        PAPERCLIP_MIGRATION_PROMPT: "never",
        PAPERCLIP_MIGRATION_AUTO_APPLY: state.firstStart ? "true" : "false",
      },
      stdio: "inherit",
    },
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(error.message);
    unlock();
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    unlock();
    process.exitCode =
      code ?? (signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1);
  });
  void (async () => {
    try {
      let ready = false;
      for (
        let attempt = 0;
        attempt < 60 && child.exitCode === null && child.signalCode === null;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: AbortSignal.timeout(1000),
          });
          const health = await response.json();
          if (
            response.ok &&
            health.status === "ok" &&
            health.commit === target.manifest.commit
          ) {
            ready = true;
            break;
          }
        } catch {}
      }
      if (!ready)
        throw new Error("服务未在 60 秒内就绪，请查看日志；未进行功能验收。");
      let pluginsPendingSync = false;
      if (state.pluginsPendingSync) {
        for (const name of Object.keys(target.manifest.plugins)) {
          const response = await fetch(
            `http://127.0.0.1:${port}/api/plugins/${encodeURIComponent(pluginKeys[name])}`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (response.status === 404) continue;
          if (!response.ok)
            throw new Error(
              "无法读取插件状态。认证实例请在管理员界面完成正式升级，再核查插件版本。",
            );
          const plugin = await response.json();
          if (plugin.status === "uninstalled") continue;
          if (plugin.status !== "ready") {
            pluginsPendingSync = true;
            console.log(
              `保留 ${name} 的 ${plugin.status} 状态，请在插件管理界面核查。`,
            );
            continue;
          }
          await registerLocalPlugin({
            pluginKey: pluginKeys[name],
            displayName: name,
            packageName: pluginNames[name],
            packagePath: state.pluginPaths[name],
            args: ["--upgrade"],
          });
        }
      }
      writeJson(path.join(localDir, "current.json"), {
        ...state,
        firstStart: false,
        pluginsPendingSync,
        lastStartedAt: new Date().toISOString(),
      });
      // Startup and plugin synchronization are complete. Upgrade/setup still
      // require an unbound HTTP port; idle historical-resource cleanup may now
      // acquire the same deployment lock while this selected release serves.
      unlock();
      console.log(
        `Paperclip ${state.release} 已启动：http://127.0.0.1:${port}。功能验收待用户进行。`,
      );
    } catch (error) {
      console.error(`部署后续步骤未完成：${error.message}`);
    }
  })();
} catch (error) {
  unlock();
  throw error;
}
