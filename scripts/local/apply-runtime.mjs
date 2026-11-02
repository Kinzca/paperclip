import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime as defaultRuntime } from './common.mjs';

const runtime = path.resolve(process.argv[2] || defaultRuntime);
const tasks = [];
for (const [overlay, target] of [
  ['stage-handoff', 'node_modules/@paperclipai/server'],
  ['postgres', 'node_modules/postgres'],
  ['sidebar-schema', 'node_modules/@paperclipai/shared'],
]) {
  const source = path.join(root, 'scripts/local/overlays', overlay);
  const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  const packageRoot = path.join(runtime, target);
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== manifest.package || pkg.version !== manifest.version) {
    throw new Error(`拒绝套用旧补丁：${pkg.name}@${pkg.version}，要求 ${manifest.package}@${manifest.version}`);
  }
  for (const [name, hashes] of Object.entries(manifest.files)) {
    const file = path.join(packageRoot, overlay === 'stage-handoff' ? 'dist/services/heartbeat' : '', name);
    const hash = existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
    if (hash !== hashes.patched && !(hash && hash === hashes.original) && !(hash === null && !hashes.original)) {
      throw new Error(`文件包含其他改动，停止并保留现场：${file}`);
    }
    if (hash !== hashes.patched) tasks.push({ source: path.join(source, name), file });
  }
}
// 先完成全部覆盖前置条件判断，再写入；每个覆盖文件保留一份原件。
for (const { source, file } of tasks) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && !existsSync(`${file}.codex-original`)) cpSync(file, `${file}.codex-original`);
  cpSync(source, file);
}
console.log(`运行时覆盖完成，写入 ${tasks.length} 个文件。`);
