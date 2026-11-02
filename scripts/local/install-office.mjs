import { office } from './common.mjs';
import { registerLocalPlugin } from './plugin-install.mjs';

await registerLocalPlugin({
  pluginKey: 'agent-pixels.compat', displayName: 'Office',
  packageName: '@agent-pixels/paperclip-plugin', packagePath: office,
});
