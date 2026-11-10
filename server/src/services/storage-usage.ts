import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
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
  const categories: StorageUsage["categories"] = ["database", "logs", "files", "workspaces", "backups", "other"]
    .map((key) => ({ key: key as Category, bytes: 0 }));
  const configured = roots.map((root) => ({ ...root, path: path.resolve(root.path) }))
    .sort((a, b) => b.path.length - a.path.length);
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
    complete, unreadableEntries, filesScanned, remoteStorageExcluded: false, externalDatabaseExcluded: false };
}

let cached: { value: Promise<StorageUsage>; expiresAt: number } | undefined;

export function instanceStorageUsage(config: Config): Promise<StorageUsage> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rootPath = resolvePaperclipInstanceRoot();
  const roots: Array<{ path: string; category: Category }> = [
    { path: rootPath, category: "other" },
    { path: resolveDefaultLogsDir(), category: "logs" },
    { path: config.databaseBackupDir, category: "backups" },
    { path: path.join(rootPath, "workspaces"), category: "workspaces" },
    { path: path.join(rootPath, "projects"), category: "workspaces" },
  ];
  if (config.databaseMode === "embedded-postgres") roots.push({ path: config.embeddedPostgresDataDir, category: "database" });
  if (config.storageProvider === "local_disk") roots.push({ path: config.storageLocalDiskBaseDir, category: "files" });
  const value = measureStorageUsage(roots, rootPath).then((result) => ({ ...result,
    remoteStorageExcluded: config.storageProvider !== "local_disk",
    externalDatabaseExcluded: config.databaseMode !== "embedded-postgres",
  }));
  cached = { value, expiresAt: Date.now() + 30_000 };
  // A failed inventory is retryable; never retain a rejected result as a cache hit.
  void value.catch(() => { if (cached?.value === value) cached = undefined; });
  return value;
}
