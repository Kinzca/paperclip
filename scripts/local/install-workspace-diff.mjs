import { workspaceDiff } from "./common.mjs";
import { registerLocalPlugin } from "./plugin-install.mjs";

await registerLocalPlugin({
  pluginKey: "paperclip.workspace-diff",
  displayName: "Workspace Diff",
  packageName: "@paperclipai/plugin-workspace-diff",
  packagePath: workspaceDiff,
});
