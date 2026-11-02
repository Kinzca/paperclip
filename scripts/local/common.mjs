import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const localDir = path.resolve(process.env.PAPERCLIP_LOCAL_DIR || path.join(root, '.paperclip-local'));
export const runtime = path.join(localDir, 'runtime');
export const office = path.join(localDir, 'Agent-Pixels');
export const pnpm = path.join(localDir, 'build-tools/node_modules/pnpm/bin/pnpm.cjs');
export const codexCli = path.join(runtime, 'node_modules/@paperclipai/server/node_modules/@openai/codex/bin/codex.js');
export const codexHome = process.env.CODEX_HOME || path.join(localDir, 'codex');
export const sdk = path.join(runtime, 'node_modules/@paperclipai/plugin-sdk/dist');
export const cli = path.join(runtime, 'node_modules/paperclipai/dist/index.js');
export const port = process.env.PAPERCLIP_PORT || '3100';
export const env = {
  ...process.env,
  PAPERCLIP_HOME: path.join(localDir, 'home'),
  PAPERCLIP_CONFIG: path.join(localDir, 'home/instances/default/config.json'),
  PAPERCLIP_INSTANCE_ID: 'default',
  CODEX_HOME: codexHome,
  PAPERCLIP_TELEMETRY_DISABLED: '1', PAPERCLIP_NO_BROWSER: 'true', PAPERCLIP_OPEN_ON_LISTEN: 'false',
  PORT: port,
  npm_config_cache: path.join(localDir, 'npm-cache'),
  PATH: [path.dirname(process.execPath), path.join(runtime, 'node_modules/.bin'),
    path.join(runtime, 'node_modules/@paperclipai/server/node_modules/.bin'), process.env.PATH].join(path.delimiter),
};
// 本安装入口只使用 Codex 订阅登录，避免环境中的 Key 覆盖订阅身份。
delete env.OPENAI_API_KEY;
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 退出：${result.status ?? result.signal}`);
}
export function runNode(args, options) { run(process.execPath, args, options); }
