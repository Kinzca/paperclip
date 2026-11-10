export interface StorageUsage {
  rootPath: string;
  measuredAt: string;
  totalBytes: number;
  complete: boolean;
  unreadableEntries: number;
  filesScanned: number;
  remoteStorageExcluded: boolean;
  externalDatabaseExcluded: boolean;
  projectRootCount: number;
  categories: Array<{
    key: "database" | "logs" | "files" | "workspaces" | "backups" | "other" | "companyProjects";
    bytes: number;
  }>;
}
