export const storageCategories = {
  database: ["Database", "bg-storage-database"], logs: ["Run logs", "bg-storage-logs"],
  files: ["Attachments and files", "bg-storage-files"], companyProjects: ["Company project directories", "bg-storage-projects"],
  workspaces: ["Managed workspaces", "bg-storage-workspaces"], backups: ["Database backups", "bg-storage-backups"],
  releases: ["Program releases", "bg-storage-releases"], checkpoints: ["Upgrade checkpoints", "bg-storage-checkpoints"],
  source: ["Source and development dependencies", "bg-storage-source"], tools: ["Tools and caches", "bg-storage-tools"],
  maintenance: ["Maintenance materials", "bg-storage-maintenance"], other: ["Other instance data", "bg-storage-other"],
} as const;
// Decimal units match Finder and the workspace inventory. Shared legacy formatting remains unchanged.
export function storageSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0; let value = bytes;
  while (Math.abs(value) >= 1000 && index < units.length - 1) { value /= 1000; index++; }
  return `${Number(value.toFixed(1))} ${units[index]}`;
}
