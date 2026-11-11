export interface InboxArchiveUndo {
  archivedAt: string;
  issueIds: string[];
}

export interface InboxArchiveResult {
  id: string;
  archivedAt: string;
  archivedIssueIds?: string[];
  skippedActiveCount?: number;
  undo?: InboxArchiveUndo;
}
