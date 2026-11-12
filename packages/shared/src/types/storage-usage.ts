export interface StorageUsage {
  rootPath: string;
  roots?: Array<{ path: string; category: string }>;
  measuredAt: string;
  totalBytes: number;
  complete: boolean;
  unreadableEntries: number;
  filesScanned: number;
  remoteStorageExcluded: boolean;
  externalDatabaseExcluded: boolean;
  projectRootCount: number;
  categories: Array<{
    key: "database" | "logs" | "files" | "workspaces" | "backups" | "other" | "companyProjects" | "releases" | "checkpoints" | "source" | "tools" | "maintenance";
    bytes: number;
  }>;
}

export type StorageCleanupKind = "backups" | "releases" | "checkpoints";
export interface StorageCleanupItem {
  id: string;
  kind: StorageCleanupKind;
  name: string;
  path: string;
  bytes: number;
  modifiedAt: string;
  protectedReason: string | null;
  complete: boolean;
}
export interface StorageCleanupInventory {
  items: StorageCleanupItem[];
  unavailable: string[];
}
export interface StorageCleanupPreview {
  token: string;
  expiresAt: string;
  items: StorageCleanupItem[];
  estimatedBytes: number;
}
export interface StorageCleanupResult {
  auditWarning?: string;
  results: Array<{ id: string; path: string; status: "deleted" | "failed"; reason?: string }>;
  deletedLogicalBytes: number;
  availableBytesChange: number | null;
}
