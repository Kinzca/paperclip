import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export const pins = {
  node: "24.22.2",
  pnpm: "9.15.4",
  dependencyKit: "2026.1023.0",
  officeCommit: "a3fff4a71eeca595572decfdca7adffeadd26a85",
};
export const pluginNames = {
  office: "@agent-pixels/paperclip-plugin",
  wiki: "@paperclipai/plugin-llm-wiki",
};
export const pluginKeys = {
  office: "agent-pixels.compat",
  wiki: "paperclipai.plugin-llm-wiki",
};
export function json(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.renameSync(temp, file);
}
export function sha(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
export function id(value) {
  if (!/^[a-f0-9]{12,40}$/.test(value ?? ""))
    throw new Error("版本必须是 12–40 位提交 SHA，不能使用路径或分支名。");
  return value;
}
export function files(directory) {
  if (!fs.existsSync(directory)) return {};
  const result = {};
  function visit(current) {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`发布产物不能包含外部符号链接：${file}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile())
        result[path.relative(directory, file).split(path.sep).join("/")] =
          sha(file);
    }
  }
  visit(directory);
  return result;
}
export function migrationLedger(runtime) {
  const dir = path.join(
    runtime,
    "node_modules/@paperclipai/db/dist/migrations",
  );
  return json(path.join(dir, "meta/_journal.json")).entries.map((entry) => ({
    tag: entry.tag,
    hash: sha(path.join(dir, `${entry.tag}.sql`)),
  }));
}
export function assertTransition(from, to, rollback = false) {
  if (to.platform !== process.platform || to.arch !== process.arch)
    throw new Error(
      "发布包属于其他操作系统或架构，请在这台电脑从同一提交重新构建。",
    );
  const previous = from.migrations;
  if (
    JSON.stringify(to.migrations.slice(0, previous.length)) !==
      JSON.stringify(previous) ||
    (rollback && to.migrations.length !== previous.length)
  )
    throw new Error(
      "数据库迁移不兼容，不能直接切换。请保留当前数据，按迁移文档把升级前备份恢复到独立实例后使用旧版本；不会自动执行降级 SQL。",
    );
  if (
    rollback &&
    ["office", "wiki"].some(
      (name) =>
        JSON.stringify(from.plugins[name].migrations) !==
        JSON.stringify(to.plugins[name].migrations),
    )
  )
    throw new Error(
      "插件数据库迁移不同，需按完整恢复流程处理，不能仅回退代码。",
    );
}
export function copy(source, target) {
  // macOS 的 cp -c 使用 APFS 克隆；Node COPYFILE_FICLONE 在部分 macOS 版本会退化为完整复制。
  if (process.platform === "darwin") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const directory = fs.lstatSync(source).isDirectory();
    if (directory) fs.mkdirSync(target, { recursive: true });
    const result = spawnSync(
      "/bin/cp",
      ["-cR", directory ? path.join(source, ".") + "/." : source, target],
      { encoding: "utf8" },
    );
    if (result.status === 0) return;
    if (result.error) throw result.error;
    // 非 APFS 目标仍允许标准复制；空间不足会由复制操作明确报错。
  }
  fs.cpSync(source, target, {
    recursive: true,
    dereference: false,
    mode: fs.constants.COPYFILE_FICLONE,
  });
}

export function copyPlugin(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of [
    "package.json",
    "dist",
    "agents",
    "skills",
    "templates",
    "migrations",
  ]) {
    const from = path.join(source, name);
    if (fs.existsSync(from)) copy(from, path.join(target, name));
  }
  for (const name of ["dist/manifest.js", "dist/worker.js", "dist/ui/index.js"])
    if (!fs.existsSync(path.join(target, name)))
      throw new Error(`插件构建不完整：${name}`);
}
export function pluginInfo(directory, name) {
  const pkg = json(path.join(directory, "package.json"));
  if (pkg.name !== pluginNames[name]) throw new Error(`插件包名不符：${name}`);
  return {
    key: pluginKeys[name],
    version: pkg.version,
    files: files(directory),
    migrations: files(path.join(directory, "migrations")),
  };
}
export function current(localDir, required = true) {
  const file = path.join(localDir, "current.json");
  if (!fs.existsSync(file)) {
    if (required)
      throw new Error("没有托管版本，请先 setup；已有安装先 adopt。");
    return null;
  }
  const state = json(file);
  id(state.release);
  return state;
}
export function release(localDir, releaseId) {
  const directory = path.join(localDir, "releases", id(releaseId));
  const manifest = json(path.join(directory, "release.json"));
  if (!manifest.commit.startsWith(releaseId) || manifest.schema !== 1)
    throw new Error("发布清单损坏或提交不匹配。");
  return { directory, manifest, runtime: path.join(directory, "runtime") };
}
export function verifyRelease(localDir, releaseId) {
  const target = release(localDir, releaseId);
  for (const [relative, hashes] of Object.entries(target.manifest.artifacts)) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
      throw new Error("非法产物路径。");
    if (
      JSON.stringify(files(path.join(target.directory, relative))) !==
      JSON.stringify(hashes)
    )
      throw new Error(
        `发布产物被修改或缺失：${relative}。重新构建，不覆盖现有版本。`,
      );
  }
  if (
    JSON.stringify(migrationLedger(target.runtime)) !==
    JSON.stringify(target.manifest.migrations)
  )
    throw new Error("迁移文件与发布清单不符。");
  return target;
}
export function assertNode() {
  if (process.versions.node !== pins.node)
    throw new Error(
      `请使用 Node.js ${pins.node}，当前 ${process.versions.node}。不同电脑采用相同工具链。`,
    );
}
export async function assertStopped(port) {
  if (
    !Number.isInteger(Number(port)) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    throw new Error("PAPERCLIP_PORT 必须是 1–65535 的有效端口。");
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) =>
      reject(
        new Error(`端口 ${port} 无法独占，请先停止本地服务：${error.message}`),
      ),
    );
    server.listen(Number(port), "127.0.0.1", () => server.close(resolve));
  });
}
export function lock(localDir) {
  fs.mkdirSync(localDir, { recursive: true });
  const file = path.join(localDir, "deployment.lock");
  const token = randomUUID();
  if (fs.existsSync(file)) {
    const previous = fs.readFileSync(file, "utf8");
    const owner = JSON.parse(previous);
    if (!Number.isInteger(owner.pid) || owner.pid <= 0)
      throw new Error(`部署锁损坏，请先核查 ${file}`);
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH" && fs.readFileSync(file, "utf8") === previous)
        fs.unlinkSync(file);
    }
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), {
      flag: "wx",
    });
  } catch (error) {
    throw new Error(
      `部署锁已存在，请确认没有安装／升级／启动进程，再处理 ${file}：${error.message}`,
    );
  }
  return () => {
    if (fs.existsSync(file) && json(file).token === token) fs.unlinkSync(file);
  };
}
export function execute(
  command,
  args,
  { cwd, env = process.env, capture = false } = {},
) {
  if (process.platform === "win32" && command === "npm") {
    args = [
      path.join(
        path.dirname(process.execPath),
        "node_modules/npm/bin/npm-cli.js",
      ),
      ...args,
    ];
    command = process.execPath;
  }
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} 失败（${result.status ?? result.signal}）${result.error?.message ?? ""}${capture ? `\n${result.stderr}` : ""}`,
    );
  return result.stdout?.trim();
}
export function git(root, args) {
  return execute("git", args, { cwd: root, capture: true });
}
export function assertClean(root) {
  const status = git(root, ["status", "--porcelain", "--untracked-files=no"]);
  if (status)
    throw new Error(
      "源码有未提交修改。请先提交或保留改动后使用干净检出，构建不会自动丢弃修改。",
    );
  return git(root, ["rev-parse", "HEAD"]);
}
export function repairDarwinLibraries(runtime) {
  if (process.platform !== "darwin") return;
  const lib = path.join(
    runtime,
    `node_modules/@embedded-postgres/darwin-${process.arch}/native/lib`,
  );
  if (!fs.existsSync(lib)) return;
  for (const name of fs.readdirSync(lib)) {
    if (!fs.lstatSync(path.join(lib, name)).isFile()) continue;
    const match = /^(lib.+)\.(\d+)(?:\.\d+)*\.dylib$/.exec(name);
    if (!match) continue;
    for (const alias of [`${match[1]}.${match[2]}.dylib`, `${match[1]}.dylib`])
      if (!fs.existsSync(path.join(lib, alias)))
        fs.symlinkSync(name, path.join(lib, alias));
  }
}
