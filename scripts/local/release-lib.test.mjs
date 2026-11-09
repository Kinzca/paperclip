import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  id,
  files,
  writeJson,
  json,
  assertTransition,
  verifyRelease,
  lock,
  copyPlugin,
  pluginInfo,
  migrationLedger,
} from "./release-lib.mjs";
const ledger = [{ tag: "0001_example", hash: "hash-1" }];
test("reclaims a reused PID deployment lock without signalling its current owner", t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, "deployment.lock"), JSON.stringify({ pid: process.pid, identity: "older process birth", token: "old" }));
  const release = lock(dir);
  assert.equal(json(path.join(dir, "deployment.lock")).pid, process.pid);
  assert.notEqual(json(path.join(dir, "deployment.lock")).token, "old");
  release();
  fs.writeFileSync(path.join(dir, "deployment.lock"), JSON.stringify({ pid: process.pid, token: "legacy-live" }));
  assert.throws(() => lock(dir), /部署锁/);
});
const manifest = () => ({
  schema: 1,
  commit: "a".repeat(40),
  platform: process.platform,
  arch: process.arch,
  migrations: structuredClone(ledger),
  plugins: { office: { migrations: {} }, wiki: { migrations: {} } },
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-release-unit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("拒绝路径、分支名和不完整版本号", () => {
  for (const value of ["../runtime", "codex/main", "abcd", "A".repeat(40)])
    assert.throws(() => id(value));
  assert.equal(id("a".repeat(12)), "a".repeat(12));
});
test("升级仅接受保持既有迁移内容的追加序列", () => {
  const from = manifest(),
    to = manifest();
  to.migrations.push({ tag: "0002_new", hash: "hash-2" });
  assert.doesNotThrow(() => assertTransition(from, to));
  to.migrations[0].hash = "changed";
  assert.throws(() => assertTransition(from, to), /迁移不兼容/);
});
test("迁移不同拒绝代码回退，兼容版本允许", () => {
  const from = manifest(),
    to = manifest();
  assert.doesNotThrow(() => assertTransition(from, to, true));
  from.migrations.push({ tag: "0002_new", hash: "hash-2" });
  assert.throws(() => assertTransition(from, to, true), /迁移不兼容/);
});
test("插件迁移变化与跨平台运行均拒绝回退", () => {
  const from = manifest(),
    to = manifest();
  to.plugins.wiki.migrations = { "0001.sql": "new" };
  assert.throws(() => assertTransition(from, to, true), /插件数据库/);
  to.platform = "not-this-os";
  assert.throws(() => assertTransition(from, to), /操作系统/);
});
test("原子版本指针不会留下临时文件", (t) => {
  const dir = fixture(t),
    file = path.join(dir, "current.json");
  writeJson(file, { release: "a".repeat(12) });
  writeJson(file, { release: "b".repeat(12) });
  assert.equal(json(file).release, "b".repeat(12));
  assert.deepEqual(fs.readdirSync(dir), ["current.json"]);
});
test("并行部署锁阻止第二个操作，正常退出可重新获取", (t) => {
  const dir = fixture(t);
  const unlock = lock(dir);
  assert.throws(() => lock(dir), /部署锁/);
  unlock();
  lock(dir)();
});
test("插件打包只复制发布文件，不带知识库和依赖", (t) => {
  const dir = fixture(t),
    source = path.join(dir, "source"),
    target = path.join(dir, "target");
  fs.mkdirSync(path.join(source, "dist/ui"), { recursive: true });
  writeJson(path.join(source, "package.json"), {
    name: "@paperclipai/plugin-llm-wiki",
    version: "0.1.3",
  });
  for (const file of [
    "dist/manifest.js",
    "dist/worker.js",
    "dist/ui/index.js",
    "private-note.md",
  ])
    fs.writeFileSync(path.join(source, file), "content");
  copyPlugin(source, target);
  assert.equal(fs.existsSync(path.join(target, "private-note.md")), false);
  assert.equal(pluginInfo(target, "wiki").version, "0.1.3");
});
test("产物缺失或被修改时拒绝启动该发布版本", (t) => {
  const dir = fixture(t),
    releaseId = "a".repeat(12),
    release = path.join(dir, "releases", releaseId),
    runtime = path.join(release, "runtime"),
    migrations = path.join(
      runtime,
      "node_modules/@paperclipai/db/dist/migrations",
    );
  fs.mkdirSync(path.join(migrations, "meta"), { recursive: true });
  writeJson(path.join(migrations, "meta/_journal.json"), {
    entries: [{ tag: "0001_example" }],
  });
  fs.writeFileSync(path.join(migrations, "0001_example.sql"), "select 1;");
  const artifact = path.join(release, "artifact");
  fs.mkdirSync(artifact);
  fs.writeFileSync(path.join(artifact, "index.js"), "original");
  writeJson(path.join(release, "release.json"), {
    ...manifest(),
    migrations: migrationLedger(runtime),
    artifacts: { artifact: files(artifact) },
  });
  assert.doesNotThrow(() => verifyRelease(dir, releaseId));
  fs.writeFileSync(path.join(artifact, "index.js"), "changed");
  assert.throws(() => verifyRelease(dir, releaseId), /产物被修改/);
});
test("不把指向用户外部文件的链接纳入发布包", (t) => {
  const dir = fixture(t),
    outside = path.join(dir, "outside"),
    inside = path.join(dir, "inside");
  fs.mkdirSync(inside);
  fs.writeFileSync(outside, "private");
  fs.symlinkSync(outside, path.join(inside, "link"));
  assert.throws(() => files(inside), /符号链接/);
});
