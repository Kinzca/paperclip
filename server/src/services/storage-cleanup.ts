import { lstat, readdir, readFile, realpath, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { projectWorkspaces, executionWorkspaces, withBackupDirectoryLock, type Db } from "@paperclipai/db";
import type { StorageCleanupItem, StorageCleanupInventory, StorageCleanupPreview, StorageCleanupResult } from "@paperclipai/shared";
import type { Config } from "../config.js";
import { conflict } from "../errors.js";
import { invalidateStorageUsage } from "./storage-usage.js";

const exec = promisify(execFile);
const within = (file: string, root: string) => file === root || file.startsWith(root + path.sep);
type Stamp = { path: string; dev: number; ino: number; size: number; mtimeMs: number; mode: number };
type Plan = { owner: string; expires: number; items: StorageCleanupItem[]; stamps: Map<string, Stamp[]> };
const plans = new Map<string, Plan>();

async function canonical(directory: string) {
  const absolute = path.resolve(directory);
  if (!path.isAbsolute(directory) || absolute === path.parse(absolute).root || await realpath(absolute) !== absolute)
    throw conflict("目录含符号链接或不在可管理范围内");
  return absolute;
}

/** Metadata identities only; no file contents or delivery hashes are computed. */
async function snapshot(target: string): Promise<{ bytes: number; stamps: Stamp[] }> {
  const stamps: Stamp[] = [];
  const pending = [target];
  const device = (await lstat(target)).dev;
  const deadline = Date.now() + 30_000;
  let bytes = 0;
  while (pending.length) {
    if (stamps.length >= 250_000 || Date.now() > deadline) throw conflict("目录未完整统计，请稍后重试");
    const file = pending.pop()!;
    const s = await lstat(file);
    if (s.dev !== device) throw conflict("目录包含其他挂载点，不能清理");
    stamps.push({ path: file, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, mode: s.mode });
    if (s.isFile()) bytes += s.size;
    if (s.isDirectory()) for (const name of await readdir(file)) pending.push(path.join(file, name));
  }
  return { bytes, stamps: stamps.sort((a, b) => a.path.localeCompare(b.path)) };
}

async function entries(directory: string) {
  try { await canonical(directory); return await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function candidates(config: Config, db: Db): Promise<StorageCleanupInventory> {
  const items: StorageCleanupItem[] = [];
  const unavailable: string[] = [];
  const localDir = process.env.PAPERCLIP_LOCAL_DIR;
  const [workspaces, executions] = await Promise.all([
    db.select({ cwd: projectWorkspaces.cwd }).from(projectWorkspaces),
    db.select({ cwd: executionWorkspaces.cwd }).from(executionWorkspaces),
  ]);
  const registered = [...workspaces, ...executions].flatMap(row => row.cwd ? [path.resolve(row.cwd)] : []);
  let state: Record<string, unknown> | null = null;
  if (localDir) {
    try { await canonical(localDir); state = JSON.parse(await readFile(path.join(localDir, "current.json"), "utf8")); }
    catch { unavailable.push("无法读取本机部署状态，运行版本及检查点暂不可清理"); }
  } else unavailable.push("当前启动方式未登记安装目录；未将未知安装资源当作零占用");
  const stateStrings: string[] = [];
  function collect(value: unknown) {
    if (typeof value === "string") stateStrings.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  collect(state);
  const roots = [{ directory: config.databaseBackupDir, kind: "backups" as const },
    ...(localDir ? [{ directory: path.join(localDir, "releases"), kind: "releases" as const },
      { directory: path.join(localDir, "checkpoints"), kind: "checkpoints" as const }] : [])];
  for (const { directory, kind } of roots) {
    try {
      for (const entry of await entries(directory)) {
        if (entry.isSymbolicLink()) continue;
        if (kind === "backups" ? !entry.isFile() || !/^paperclip-\d{8}-\d{6}(?:-[\da-f-]+)?\.sql\.gz$/.test(entry.name)
          : !entry.isDirectory()) continue;
        const target = path.join(directory, entry.name);
        const s = await lstat(target);
        let reason: string | null = null;
        if (kind !== "backups") {
          if (!state || !process.env.PAPERCLIP_RELEASE_LIB) reason = "缺少受支持的本机部署入口";
          else if (state.pending) reason = "存在未完成部署";
          else if (stateStrings.some(value => value === entry.name || value === target || within(value, target)))
            reason = "当前、上一版本或部署状态仍引用此项";
          else if (registered.some(root => within(root, target) || within(target, root))) reason = "已登记工作区仍引用此目录";
          else if (kind === "releases" && !/^[a-f0-9]{12,40}$/.test(entry.name)) reason = "未完成构建或未知版本目录";
          else if (kind === "checkpoints" && !/^\d+-[a-f0-9]{12,40}-to-[a-f0-9]{12,40}$/.test(entry.name)) reason = "未知检查点目录";
        }
        items.push({ id: `${kind}:${entry.name}`, kind, name: entry.name, path: target,
          bytes: s.isFile() ? s.size : 0, modifiedAt: s.mtime.toISOString(), protectedReason: reason, complete: s.isFile() });
      }
    } catch (error) { unavailable.push(`${directory}: ${(error as Error).message}`); }
  }
  const backups = items.filter(item => item.kind === "backups").sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  if (backups[0]) backups[0].protectedReason = "保留最新数据库备份（未代表已验证恢复）";
  return { items: items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)), unavailable };
}

export async function storageCleanupInventory(config: Config, db: Db) {
  const result = await candidates(config, db);
  for (const item of result.items) {
    if (item.complete) continue;
    try { item.bytes = (await snapshot(item.path)).bytes; item.complete = true; }
    catch (error) { item.protectedReason = (error as Error).message; }
  }
  return result;
}

export async function previewStorageCleanup(config: Config, db: Db, ids: string[], owner: string): Promise<StorageCleanupPreview> {
  for (const [token, plan] of plans) if (plan.expires < Date.now()) plans.delete(token);
  if (plans.size >= 20) throw conflict("预览数量过多，请等待旧预览过期");
  const inventory = await candidates(config, db);
  const items = [...new Set(ids)].map(id => {
    const item = inventory.items.find(candidate => candidate.id === id);
    if (!item || item.protectedReason) throw conflict(item?.protectedReason ?? "清理项已不存在，请刷新");
    return item;
  });
  const stamps = new Map<string, Stamp[]>();
  for (const item of items) {
    await canonical(item.path);
    const scanned = await snapshot(item.path);
    item.bytes = scanned.bytes; item.complete = true; stamps.set(item.id, scanned.stamps);
  }
  const token = randomUUID(); const expires = Date.now() + 10 * 60_000;
  plans.set(token, { owner, expires, items, stamps });
  return { token, expiresAt: new Date(expires).toISOString(), items, estimatedBytes: items.reduce((sum, item) => sum + item.bytes, 0) };
}

async function assertNoProcessReferences(target: string, directory: boolean) {
  if (process.platform === "win32") throw conflict("本平台暂不能确认进程引用，保留此运行资源");
  const { stdout } = await exec("ps", ["-axo", "command="], { maxBuffer: 16 * 1024 * 1024 });
  if (stdout.includes(target)) throw conflict("有进程命令仍引用此目录");
  try {
    const result = await exec("lsof", ["-nP", "-t", ...(directory ? ["+D"] : []), target], { maxBuffer: 4 * 1024 * 1024 });
    if (result.stdout.trim()) throw conflict("有进程仍打开此目录中的文件");
  } catch (error) {
    const result = error as { code?: number; stderr?: string; stdout?: string };
    // lsof uses exit 1 for no matching files. Permission/inspection errors fail closed.
    if (result.code !== 1 || result.stderr?.trim() || result.stdout?.trim()) throw error;
  }
}

export async function executeStorageCleanup(config: Config, db: Db, token: string, owner: string,
  audit: (phase: string, details: Record<string, unknown>) => Promise<void>): Promise<StorageCleanupResult> {
  const plan = plans.get(token);
  if (!plan || plan.owner !== owner || plan.expires < Date.now()) throw conflict("预览已过期或不属于当前用户，请重新预览");
  plans.delete(token); // Single-use, including partial failure.
  return withBackupDirectoryLock(config.databaseBackupDir, async () => {
    let unlock: (() => void) | undefined;
    if (plan.items.some(item => item.kind !== "backups")) {
      const library = process.env.PAPERCLIP_RELEASE_LIB;
      if (!library || !process.env.PAPERCLIP_LOCAL_DIR) throw conflict("缺少本机部署入口");
      const native = await import(pathToFileURL(library).href);
      unlock = native.lock(process.env.PAPERCLIP_LOCAL_DIR);
    }
    try {
      const before = await statfs(config.databaseBackupDir);
      const backupDevice = (await lstat(config.databaseBackupDir)).dev;
      const fresh = await candidates(config, db);
      const result: StorageCleanupResult = { results: [], deletedLogicalBytes: 0, availableBytesChange: null };
      await audit("started", { token, paths: plan.items.map(item => item.path) });
      for (const item of plan.items) {
        try {
          const current = fresh.items.find(candidate => candidate.id === item.id);
          if (!current || current.protectedReason) throw conflict(current?.protectedReason ?? "清理项已变化");
          await canonical(item.path);
          await assertNoProcessReferences(item.path, item.kind !== "backups");
          const now = await snapshot(item.path);
          if (JSON.stringify(now.stamps) !== JSON.stringify(plan.stamps.get(item.id))) throw conflict("预览后文件已变化，请重新预览");
          // No arbitrary paths from clients; targets come exclusively from the server-side preview.
          await rm(item.path, { recursive: item.kind !== "backups", force: false });
          result.results.push({ id: item.id, path: item.path, status: "deleted" });
          result.deletedLogicalBytes += item.bytes;
        } catch (error) { result.results.push({ id: item.id, path: item.path, status: "failed", reason: (error as Error).message }); }
      }
      const after = await statfs(config.databaseBackupDir);
      if (plan.items.every(item => plan.stamps.get(item.id)?.[0]?.dev === backupDevice))
        result.availableBytesChange = (after.bavail * after.bsize) - (before.bavail * before.bsize);
      invalidateStorageUsage();
      try { await audit("finished", { ...result }); }
      catch (error) { result.auditWarning = `清理结果审计写入失败：${(error as Error).message}`; }
      return result;
    } finally { unlock?.(); }
  });
}
