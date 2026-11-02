import { wiki } from './common.mjs';
import { registerLocalPlugin } from './plugin-install.mjs';

await registerLocalPlugin({
  pluginKey: 'paperclipai.plugin-llm-wiki', displayName: 'Wiki',
  packageName: '@paperclipai/plugin-llm-wiki', packagePath: wiki,
});
