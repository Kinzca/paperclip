export interface ArchivedChatCleanupFile {
  kind: "attachment" | "run_log" | "workspace";
  path: string;
  provider?: string;
  objectKey?: string;
  runId?: string;
  workspaceId?: string;
  generation?: number;
  bytes: number;
  identity?: { dev: number; ino: number; size: number; mtimeMs: number };
  status: "pending" | "removed" | "failed";
  error?: string;
}

export interface ArchivedChatCleanupPlan {
  files: ArchivedChatCleanupFile[];
  retained: Array<{ path: string; reason: string }>;
  localBytes: number;
}

export interface ArchivedChatCleanupJob {
  id: string;
  title: string;
  files: ArchivedChatCleanupFile[];
  removedBytes: number;
}

export interface ArchivedChatCleanupResult {
  items: Array<{ id: string; status: "deleted" | "skipped" | "failed"; reason: string; fileCleanupFailed: boolean; cleanupJobId?: string }>;
  estimatedLocalBytesRemoved: number;
}

export type CleanupProtection = "protected" | "rebuildable" | "candidate";

export interface ArchivedChatCleanupPreview {
  previewOnly: true;
  measuredAt: string;
  truncated: boolean;
  skipRelated: boolean;
  items: Array<{
    id: string;
    title: string | null;
    identifier: string | null;
    parentId: string | null;
    childCount: number;
    linked: boolean;
    ownProtectionReason: string | null;
    protection: "protected" | "candidate";
    reason: string;
    localAttachmentBytes: number;
    databaseRecordBytes: number;
    filePlan: ArchivedChatCleanupPlan;
  }>;
}

export interface ProjectSpaceUsage {
  companyId: string;
  measuredAt: string;
  previewOnly: true;
  complete: boolean;
  exclusiveBytes: number;
  sharedBytes: number;
  unattributedRegisteredAttachmentBytes: number;
  unattributedRegisteredLogBytes: number;
  projects: Array<{
    id: string;
    name: string;
    exclusiveBytes: number;
    sharedBytes: number;
    activeOrPaused: boolean;
    registeredAttachmentBytes: number;
    registeredLogBytes: number;
    roots: Array<{
      path: string;
      shared: boolean;
      status: "measured" | "partial" | "missing" | "unavailable" | "covered";
      bytes: number;
      directories: Array<{
        path: string;
        name: string;
        kind: "source" | "deliverables" | "build" | "dependencies" | "cache" | "temporary" | "other";
        bytes: number;
        complete: boolean;
        protection: CleanupProtection;
        reason: string;
      }>;
    }>;
  }>;
}
