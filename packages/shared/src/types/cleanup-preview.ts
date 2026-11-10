export type CleanupProtection = "protected" | "rebuildable" | "candidate";

export interface ArchivedChatCleanupPreview {
  previewOnly: true;
  measuredAt: string;
  truncated: boolean;
  items: Array<{
    id: string;
    title: string | null;
    identifier: string | null;
    protection: "protected" | "candidate";
    reason: string;
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
        protection: CleanupProtection;
        reason: string;
      }>;
    }>;
  }>;
}
