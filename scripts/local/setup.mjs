import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, localDir, runtime, office, pnpm, sdk, env, run, runNode } from './common.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 11)) throw new Error('请先安装 Node.js >= 24.11。');
mkdirSync(localDir, { recursive: true });
cpSync(path.join(root, 'scripts/local/runtime'), runtime, { recursive: true });
// npm ci 仅重建本入口的隔离运行时，不触碰其他 Paperclip 安装或数据库。
run('npm', ['ci', '--prefix', runtime, '--no-audit', '--no-fund']);
runNode([path.join(root, 'scripts/local/apply-runtime.mjs')]);
run('npm', ['install', '--prefix', path.join(localDir, 'build-tools'), '--no-audit', '--no-fund', '--ignore-scripts', 'pnpm@9.15.4']);
runNode([pnpm, '--filter', '@paperclipai/ui...', 'install', '--frozen-lockfile', '--ignore-scripts']);
runNode([pnpm, '--filter', '@paperclipai/ui', 'build']);
cpSync(path.join(root, 'ui/dist'), path.join(runtime, 'node_modules/@paperclipai/server/ui-dist'), { recursive: true });

const officeCommit = 'dec2d72498e5b7bd46a6575c1d58beed43a18b81';
if (!existsSync(office)) {
  run('git', ['clone', 'https://github.com/Kinzca/Agent-Pixels.git', office]);
  run('git', ['checkout', '--detach', officeCommit], { cwd: office });
} else {
  // 不覆盖其他人对插件工作区的修改，也不隐式切换已有分支。
  const { spawnSync } = await import('node:child_process');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: office, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: office, encoding: 'utf8' });
  if (head.status !== 0 || status.status !== 0 || head.stdout.trim() !== officeCommit || status.stdout.trim()) {
    throw new Error(`已有 Office 工作区与固定版本不同，请保留后另行处理：${office}`);
  }
}
runNode([pnpm, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: office });
run('npm', ['run', 'build'], { cwd: office, env: { ...env, PAPERCLIP_SDK_DIST: sdk } });
writeFileSync(path.join(localDir, 'installation.json'), JSON.stringify({ release: '2026.1023.0', officeCommit }, null, 2) + '\n');
console.log('安装和构建完成。下一步按 FORK.md 登录 Codex、启动服务并安装 Office；尚未执行功能验收。');
