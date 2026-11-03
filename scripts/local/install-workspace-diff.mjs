import { workspaceDiff, port } from "./common.mjs";
import { registerLocalPlugin } from "./plugin-install.mjs";

await registerLocalPlugin({
  pluginKey: "paperclip.workspace-diff",
  displayName: "Workspace Diff",
  packageName: "@paperclipai/plugin-workspace-diff",
  packagePath: workspaceDiff,
});

// 此宿主将项目／执行工作区详情也放在实验功能路由门禁后。
// 仅开启访问能力；不修改 enableIsolatedWorkspacesByDefault 或项目策略。
if (!process.argv.includes("--help")) {
  const url = `http://127.0.0.1:${port}/api/instance/settings/experimental`;
  let response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`无法读取工作区开关（HTTP ${response.status}），请由实例管理员启用隔离工作区页面。`);
  let settings = await response.json();
  if (settings.enableIsolatedWorkspaces !== true) {
    response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enableIsolatedWorkspaces: true }),
      signal: AbortSignal.timeout(10000),
    });
    settings = await response.json();
    if (!response.ok || settings.enableIsolatedWorkspaces !== true)
      throw new Error(`工作区开关未启用（HTTP ${response.status}），插件已登记；请由实例管理员检查该设置。`);
  }
  console.log("工作区页面已启用。刷新浏览器后进入具体工作区的 Changes 页签；默认隔离策略未修改。");
}
