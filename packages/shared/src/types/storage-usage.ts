export interface StorageUsage {
  rootPath: string;
  measuredAt: string;
  totalBytes: number;
  complete: boolean;
  unreadableEntries: number;
  filesScanned: number;
  remoteStorageExcluded: boolean;
  externalDatabaseExcluded: boolean;
  categories: Array<{
    key: "database" | "logs" | "files" | "workspaces" | "backups" | "other";
    bytes: number;
  }>;
}
