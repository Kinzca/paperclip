import { and, eq, inArray, or } from "drizzle-orm";
import { agents, issueThreadInteractions, type Db } from "@paperclipai/db";
import type { WorkflowNodeState } from "@paperclipai/shared";
import { issueService } from "../issues.js";
import { issueTreeControlService } from "../issue-tree-control.js";

/** Only persisted, company-scoped dependencies and addressed question events count as waits. */
export async function workflowDependencyWait(db: Db, companyId: string, issueId: string,
  prior?: WorkflowNodeState["delegatedWait"],
) {
  const tasks = issueService(db);
  const tree = await issueTreeControlService(db).listTreeIssues(companyId, issueId);
  const byId = new Map(tree.map(task => [task.id, task]));
  if (!byId.has(issueId)) return null;
  const readiness = await tasks.listDependencyReadiness(companyId, tree.map(task => task.id));
  const interactions = await db.select().from(issueThreadInteractions).where(and(
    eq(issueThreadInteractions.companyId, companyId),
    inArray(issueThreadInteractions.issueId, tree.map(task => task.id)),
    inArray(issueThreadInteractions.kind, ["ask_user_questions", "request_confirmation"]),
    eq(issueThreadInteractions.continuationPolicy, "wake_assignee"),
    or(eq(issueThreadInteractions.status, "pending"),
      prior?.interactionIds.length ? inArray(issueThreadInteractions.id, prior.interactionIds) : undefined),
  ));
  // A last-run error is recoverable; it is not an operator pause or termination.
  const availableAgents = new Set((await db.select({ id: agents.id }).from(agents).where(and(
    eq(agents.companyId, companyId), inArray(agents.status, ["active", "idle", "running", "error"]),
  ))).map(agent => agent.id));
  const waitingInteractions = new Set<string>();
  const observedInteractions = new Set<string>();
  let human = false;
  const visiting = new Set<string>();
  const checked = new Set<string>();
  function isInternalWork(id: string): boolean {
    if (visiting.has(id)) return false;
    if (checked.has(id)) return true;
    const task = byId.get(id);
    if (!task || task.status === "cancelled" || task.status === "backlog") return false;
    if (task.status === "done") return true;
    if (!task.assigneeAgentId || task.assigneeUserId) return false;
    if (task.status === "blocked") {
      const cards = interactions.filter(card => card.issueId === id && (
        card.status === "pending" || prior?.interactionIds.includes(card.id)
      ) && card.status !== "cancelled" && card.status !== "expired");
      for (const card of cards) {
        observedInteractions.add(card.id);
        if (card.status === "pending") {
          if (card.effectiveResolverPolicy === "human_only" || card.addresseeUserId) human = true;
          else if (!card.addresseeAgentId || !availableAgents.has(card.addresseeAgentId)) return false;
          waitingInteractions.add(card.id);
        } else if (card.status !== "answered" && !(card.kind === "request_confirmation" && card.status === "approved")) return false;
      }
      const blockers = readiness.get(id)?.blockerIssueIds ?? [];
      if (!blockers.length && !cards.length) return false;
      // A decision addressed to a human on this node parks this path, not its
      // runnable siblings. Do not reinterpret parked descendants as a global stop.
      if (id === issueId && cards.some(card =>
        (card.effectiveResolverPolicy === "human_only" || card.addresseeUserId) &&
        (card.status === "pending" || blockers.length > 0)
      )) {
        checked.add(id);
        return true;
      }
      visiting.add(id);
      const internal = blockers.every(isInternalWork);
      visiting.delete(id);
      if (!internal) return false;
    }
    checked.add(id);
    return true;
  }
  if (!isInternalWork(issueId)) return null;
  const root = readiness.get(issueId)!;
  const kind: NonNullable<WorkflowNodeState["delegatedWait"]>["kind"] = human
    ? "human_interaction" : waitingInteractions.size ? "agent_interaction" : "dependencies";
  // Reuse the native finalize barrier; done does not mean restored to the reader's workspace.
  return {
    ready: root.isDependencyReady && waitingInteractions.size === 0,
    blockerIssueIds: root.blockerIssueIds,
    wait: { kind, issueIds: [...checked], interactionIds: [...observedInteractions] },
  };
}
