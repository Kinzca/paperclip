import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { projectWorkspaces, executionWorkspaces, type Db } from "@paperclipai/db";
import type { StorageUsage } from "@paperclipai/shared";
import type { Config } from "../config.js";
import { resolvePaperclipInstanceRoot, resolveDefaultLogsDir } from "../home-paths.js";

type Category = StorageUsage["categories"][number]["key"];

/** Metadata-only, bounded inventory. Never follows links or reads file content. */
export async function measureStorageUsage(
  roots: Array<{ path: string; category: Category }>,
  rootPath: string,
  limits = { maxEntries: 50_000, maxMs: 3_000 },
): Promise<StorageUsage> {
  const categories: StorageUsage["categories"] = ["database", "logs", "files", "companyProjects", "workspaces", "backups", "other"]
    .map((key) => ({ key: key as Category, bytes: 0 }));
  const configured = roots.map((root) => ({ ...root, path: path.resolve(root.path) }))
    .sort((a, b) => b.path.length - a.path.length || Number(a.category === "companyProjects") - Number(b.category === "companyProjects"));
  const inside = (file: string, root: string) => file === root || file.startsWith(root + path.sep);
  const scanRoots = configured.filter((root, i) => !configured.some((other, j) =>
    j !== i && inside(root.path, other.path) && (root.path !== other.path || j < i)));
  const pending = scanRoots.map((root) => root.path);
  const deadline = Date.now() + limits.maxMs;
  let entries = 0;
  let filesScanned = 0;
  let unreadableEntries = 0;
  let complete = true;
  while (pending.length) {
    if (entries >= limits.maxEntries || Date.now() >= deadline) { complete = false; break; }
    const current = pending.pop()!;
    entries++;
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const directory = await opendir(current);
        for await (const entry of directory) {
          if (entries + pending.length >= limits.maxEntries || Date.now() >= deadline) { complete = false; break; }
          if (!entry.isSymbolicLink()) pending.push(path.join(current, entry.name));
        }
      } else if (stat.isFile()) {
        const category = configured.find((root) => inside(current, root.path))?.category ?? "other";
        categories.find((item) => item.key === category)!.bytes += stat.size;
        filesScanned++;
      }
    } catch (error) {
      // Missing files may be removed during the scan; unreadable paths make the
      // result partial rather than incorrectly asserting they occupy zero bytes.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      if (code === "EACCES" || code === "EPERM") { unreadableEntries++; complete = false; continue; }
      throw error;
    }
  }
  return { rootPath, measuredAt: new Date().toISOString(), categories,
    totalBytes: categories.reduce((sum, item) => sum + item.bytes, 0),
    complete, unreadableEntries, filesScanned, remoteStorageExcluded: false, externalDatabaseExcluded: false,
    projectRootCount: new Set(configured.filter((root) => root.category === "companyProjects").map((root) => root.path)).size };
}

const cache = new Map<boolean, { value: Promise<StorageUsage>; expiresAt: number }>();

export function instanceStorageUsage(config: Config, db: Db, expanded = false): Promise<StorageUsage> {
  const cached = cache.get(expanded);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rootPath = resolvePaperclipInstanceRoot();
  const roots: Array<{ path: string; category: Category }> = [
    { path: rootPath, category: "other" },
    { path: resolveDefaultLogsDir(), category: "logs" },
    { path: process.env.RUN_LOG_BASE_PATH ?? path.join(rootPath, "data", "run-logs"), category: "logs" },
    { path: config.databaseBackupDir, category: "backups" },
    { path: path.join(rootPath, "workspaces"), category: "workspaces" },
    { path: path.join(rootPath, "projects"), category: "workspaces" },
  ];
  if (config.databaseMode === "embedded-postgres") roots.push({ path: config.embeddedPostgresDataDir, category: "database" });
  if (config.storageProvider === "local_disk") roots.push({ path: config.storageLocalDiskBaseDir, category: "files" });
  const value = (async () => {
    const [workspaceRows, executionRows] = await Promise.all([
      db.select({ cwd: projectWorkspaces.cwd }).from(projectWorkspaces).where(and(isNotNull(projectWorkspaces.cwd),
        sql`${projectWorkspaces.sourceType} IN ('local_path', 'non_git_path', 'git_repo')`)),
      db.select({ cwd: executionWorkspaces.cwd }).from(executionWorkspaces).where(and(isNotNull(executionWorkspaces.cwd),
        eq(executionWorkspaces.providerType, "local_fs"), sql`${executionWorkspaces.status} <> 'deleted'`)),
    ]);
    let incompleteProjectRoots = false;
    for (const registered of new Set([...workspaceRows, ...executionRows].map((row) => row.cwd).filter((cwd): cwd is string => !!cwd))) {
      if (!path.isAbsolute(registered)) { incompleteProjectRoots = true; continue; }
      const directory = path.resolve(registered);
      if (directory === path.parse(directory).root || directory === os.homedir()) { incompleteProjectRoots = true; continue; }
      try {
        if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory()) { incompleteProjectRoots = true; continue; }
        roots.push({ path: directory, category: "companyProjects" });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (["ENOENT", "EACCES", "EPERM"].includes(code ?? "")) { incompleteProjectRoots = true; continue; }
        throw error;
      }
    }
    const result = await measureStorageUsage(roots, rootPath,
      { maxEntries: expanded ? 500_000 : 200_000, maxMs: expanded ? 10_000 : 3_000 });
    return { ...result, complete: result.complete && !incompleteProjectRoots,
      remoteStorageExcluded: config.storageProvider !== "local_disk",
      externalDatabaseExcluded: config.databaseMode !== "embedded-postgres" };
  })();
  cache.set(expanded, { value, expiresAt: Date.now() + 30_000 });
  // A failed inventory is retryable; never retain a rejected result as a cache hit.
  void value.catch(() => { if (cache.get(expanded)?.value === value) cache.delete(expanded); });
  return value;
}
