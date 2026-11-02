import type { agentWakeupRequests, issues } from "@paperclipai/db";
import type { IssueExecutionState } from "@paperclipai/shared";

type StageIssue = Pick<typeof issues.$inferSelect,
  "id" | "companyId" | "status" | "assigneeAgentId" | "executionState">;
type StageWake = Pick<typeof agentWakeupRequests.$inferSelect,
  "companyId" | "agentId" | "source" | "reason" | "payload">;
const reasons = new Set(["execution_review_requested", "execution_approval_requested", "execution_changes_requested"]);

export function isStageHandoff(source: string, reason: string | null | undefined, context: Record<string, unknown> | null | undefined) {
  return source === "assignment" && reasons.has(reason ?? "") && context?.source === "issue.execution_stage";
}

export function stageWaitSnapshot(issue: Pick<StageIssue, "executionState">) {
  return JSON.stringify(issue.executionState ?? null);
}

/** 回执须匹配公司、负责人、完整阶段快照；最终在任务行锁内再次调用。 */
export function isCurrentStageWait(issue: StageIssue | undefined, wake: StageWake) {
  const payload = wake.payload ?? {};
  const context = payload._paperclipWakeContext as Record<string, unknown> | undefined;
  if (!issue || issue.companyId !== wake.companyId || issue.id !== payload.issueId ||
      ["done", "cancelled"].includes(issue.status) || issue.assigneeAgentId !== wake.agentId ||
      !isStageHandoff(wake.source, wake.reason, context) ||
      payload.executionStageWait !== stageWaitSnapshot(issue)) return false;
  const state = issue.executionState as unknown as IssueExecutionState | null;
  if (wake.reason === "execution_changes_requested") {
    return state?.status === "changes_requested" && state.returnAssignee?.type === "agent" && state.returnAssignee.agentId === wake.agentId;
  }
  return state?.status === "pending" && state.currentParticipant?.type === "agent" &&
    state.currentParticipant.agentId === wake.agentId &&
    state.currentStageType === (wake.reason === "execution_approval_requested" ? "approval" : "review");
}
