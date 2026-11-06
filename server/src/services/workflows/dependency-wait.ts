import type { Db } from "@paperclipai/db";
import { issueService } from "../issues.js";
import { issueTreeControlService } from "../issue-tree-control.js";

/** A structured wait may only depend on automated work in this node's own subtree. */
export async function workflowDependencyWait(db: Db, companyId: string, issueId: string) {
  const tasks = issueService(db);
  const root = await tasks.getDependencyReadiness(issueId);
  if (!root.blockerIssueIds.length) return null;
  const tree = await issueTreeControlService(db).listTreeIssues(companyId, issueId);
  const byId = new Map(tree.map(task => [task.id, task]));
  const readiness = await tasks.listDependencyReadiness(companyId, tree.map(task => task.id));
  const visiting = new Set<string>([issueId]);
  const checked = new Set<string>();
  function isInternalWork(id: string): boolean {
    if (visiting.has(id)) return false;
    if (checked.has(id)) return true;
    const task = byId.get(id);
    if (!task || task.status === "cancelled" || task.status === "backlog") return false;
    if (task.status === "done") return true;
    if (!task.assigneeAgentId || task.assigneeUserId) return false;
    if (task.status === "blocked") {
      const blockers = readiness.get(id)?.blockerIssueIds ?? [];
      if (!blockers.length) return false;
      visiting.add(id);
      const internal = blockers.every(isInternalWork);
      visiting.delete(id);
      if (!internal) return false;
    }
    checked.add(id);
    return true;
  }
  if (!root.blockerIssueIds.every(isInternalWork)) return null;
  // Reuse the native finalize barrier; done does not mean restored to the reader's workspace.
  return { ready: root.isDependencyReady, blockerIssueIds: root.blockerIssueIds };
}
