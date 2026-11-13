import type { Issue, IssueTreeControlPreview, WorkflowRunDetail } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { workflowsApi } from "@/api/workflows";
import { heartbeatsApi } from "@/api/heartbeats";

const terminalWorkflow = (run: WorkflowRunDetail) => ["succeeded", "failed", "cancelled"].includes(run.status);
export interface TaskArchivePreparation {
  task: Issue;
  tree: IssueTreeControlPreview;
  workflows: WorkflowRunDetail[];
}

export async function prepareTaskArchive(id: string): Promise<TaskArchivePreparation> {
  const task = await issuesApi.get(id);
  const preview = await issuesApi.previewTreeControl(id, { mode: "cancel" });
  const tree = task.conversationAgentId ? { ...preview,
    issues: preview.issues.filter(issue => issue.id === id),
    activeRuns: preview.activeRuns.filter(run => run.issueId === id),
  } : preview;
  const workflows = new Map<string, WorkflowRunDetail>();
  const scope = new Set(tree.issues.map(issue => issue.id));
  for (const issue of tree.issues) {
    const run = await workflowsApi.run(issue.id);
    if (!run || terminalWorkflow(run)) continue;
    if (!scope.has(run.issueId)) {
      throw new Error("This task belongs to a workflow outside this scope. Stop that workflow from its parent task first.");
    }
    workflows.set(run.id, run);
  }
  return { task, tree, workflows: [...workflows.values()] };
}

/** Called only after the inline second click. Never archives on a stop failure.
 * Workflow versions and the native hold's confirmed membership protect scope.
 */
export async function stopTaskForArchive(preparation: TaskArchivePreparation): Promise<void> {
  const { task, tree, workflows } = preparation;
  if (task.conversationAgentId) {
    for (const run of tree.activeRuns) await heartbeatsApi.cancel(run.id);
  } else {
    await issuesApi.createTreeHold(task.id, { mode: "cancel", reason: "Confirmed stop before archiving.",
      expectedIssueIds: tree.issues.map(issue => issue.id) });
  }
  for (const run of workflows) {
    const current = await workflowsApi.run(run.issueId);
    if (!current || current.id !== run.id) throw new Error("The workflow changed. Review and confirm the archive again.");
    if (terminalWorkflow(current)) continue;
    await workflowsApi.control(run.issueId, { action: "cancel", expectedVersion: run.version, reason: "Confirmed stop before archiving." });
  }
  const deadline = Date.now() + 20_000;
  while (true) {
    const preview = await issuesApi.previewTreeControl(task.id, { mode: "cancel" });
    const current = task.conversationAgentId ? { ...preview,
      issues: preview.issues.filter(issue => issue.id === task.id),
      activeRuns: preview.activeRuns.filter(run => run.issueId === task.id),
    } : preview;
    const confirmedIds = new Set(tree.issues.map(issue => issue.id));
    if (current.issues.length !== confirmedIds.size || current.issues.some(issue => !confirmedIds.has(issue.id))) {
      throw new Error("The task scope changed. Review and confirm the archive again.");
    }
    let stopped = current.activeRuns.length === 0 && (task.conversationAgentId || current.issues.every(issue => ["done", "cancelled"].includes(issue.status)));
    for (const issue of current.issues) {
      const run = await workflowsApi.run(issue.id);
      if (run && !terminalWorkflow(run)) stopped = false;
    }
    if (stopped) return;
    if (Date.now() >= deadline) throw new Error("Stopping is not yet confirmed. The task has not been archived. Review its execution before retrying.");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/** Keyboard/toolbar entry points use the same visible two-click control. */
export function requestTaskArchive(id: string) {
  const buttons = document.querySelectorAll<HTMLButtonElement>(`button[data-task-archive-id="${CSS.escape(id)}"]`);
  const button = [...buttons].find(item => item.getClientRects().length > 0 && !item.disabled);
  button?.focus();
  button?.click();
}
