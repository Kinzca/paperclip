import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, localDir, runtime, office, pnpm, env, run, runNode } from './common.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 11)) throw new Error('请先安装 Node.js >= 24.11。');
mkdirSync(localDir, { recursive: true });
cpSync(path.join(root, 'scripts/local/runtime'), runtime, { recursive: true });
// npm ci 仅重建本入口的隔离运行时，不触碰其他 Paperclip 安装或数据库。
run('npm', ['ci', '--prefix', runtime, '--no-audit', '--no-fund']);
runNode([path.join(root, 'scripts/local/apply-runtime.mjs')]);
run('npm', ['install', '--prefix', path.join(localDir, 'build-tools'), '--no-audit', '--no-fund', '--ignore-scripts', 'pnpm@9.15.4']);
runNode([pnpm, '--filter', '@paperclipai/ui...', 'install', '--frozen-lockfile', '--ignore-scripts']);
runNode([pnpm, '--filter', '@paperclipai/plugin-sdk', 'ensure-build-deps']);
runNode([pnpm, '--filter', '@paperclipai/ui', 'build']);
cpSync(path.join(root, 'ui/dist'), path.join(runtime, 'node_modules/@paperclipai/server/ui-dist'), { recursive: true });

const officeCommit = 'a3fff4a71eeca595572decfdca7adffeadd26a85';
const previousOfficeCommits = ['dec2d72498e5b7bd46a6575c1d58beed43a18b81', '5b0a435a288cd7164b2d79aeb5aa84006ed2ce6e'];
if (!existsSync(office)) {
  run('git', ['clone', 'https://github.com/Kinzca/Agent-Pixels.git', office]);
  run('git', ['checkout', '--detach', officeCommit], { cwd: office });
} else {
  // 不覆盖其他人对插件工作区的修改，也不隐式切换已有分支。
  const { spawnSync } = await import('node:child_process');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: office, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: office, encoding: 'utf8' });
  if (head.status !== 0 || status.status !== 0 || status.stdout.trim()) {
    throw new Error(`已有 Office 工作区有改动或无法读取，请保留后另行处理：${office}`);
  }
  if (previousOfficeCommits.includes(head.stdout.trim())) {
    const { readFileSync } = await import('node:fs');
    if (readFileSync(path.join(office, '.git/HEAD'), 'utf8').startsWith('ref:')) {
      throw new Error(`Office 位于用户分支，保留现场，请显式更新到 ${officeCommit}`);
    }
    run('git', ['fetch', 'origin', officeCommit], { cwd: office });
    run('git', ['checkout', '--detach', officeCommit], { cwd: office });
  } else if (head.stdout.trim() !== officeCommit) {
    throw new Error(`已有 Office 工作区与固定版本不同，请保留后另行处理：${office}`);
  }
}
runNode([pnpm, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: office });
run('npm', ['run', 'build'], { cwd: office, env: { ...env, PAPERCLIP_SDK_DIST: path.join(root, 'packages/plugins/sdk/dist') } });
writeFileSync(path.join(localDir, 'installation.json'), JSON.stringify({ release: '2026.1023.0', officeCommit }, null, 2) + '\n');
console.log('安装和构建完成。下一步按 FORK.md 登录 Codex、启动服务并安装 Office；尚未执行功能验收。');
