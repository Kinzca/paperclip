import { createHash } from "node:crypto";
import type {
  WorkflowRuntimeState,
  WorkflowSnapshot,
  WorkflowNodeState,
  WorkflowReviewReport,
} from "@paperclipai/shared";

type TimedRun = {
  status: string;
  deadlineAt: Date;
  runtime: WorkflowRuntimeState;
  snapshot: WorkflowSnapshot;
  nodes: Record<string, WorkflowNodeState>;
};

/** 将已冻结的等待时长归还给自动执行时钟，原始额度不变。 */
export function settleHumanWait(run: TimedRun, now = Date.now()) {
  if (!run.runtime.humanWaitStartedAt) return;
  const started = Date.parse(run.runtime.humanWaitStartedAt);
  if (Number.isFinite(started))
    run.deadlineAt = new Date(
      run.deadlineAt.getTime() + Math.max(0, now - started),
    );
  delete run.runtime.humanWaitStartedAt;
}

export function updateHumanWait(run: TimedRun, now = Date.now()) {
  const active = run.snapshot.definition.nodes.filter(
    (node) => run.nodes[node.id]?.status === "running",
  );
  const waiting =
    run.status === "running" &&
    active.length > 0 &&
    active.every(
      (node) =>
        (node.kind === "review" || node.kind === "approval") &&
        !!run.nodes[node.id].userId &&
        !run.nodes[node.id].agentId,
    );
  if (waiting) run.runtime.humanWaitStartedAt ??= new Date(now).toISOString();
  else settleHumanWait(run, now);
}

export const REPEATED_FAILURE_LIMIT = 3;

/** 只认定可复现的重复信号，不用模型猜测“没有进展”。 */
export function recordWorkflowFailure(
  runtime: WorkflowRuntimeState,
  nodeId: string,
  attempt: number,
  reason: string,
  report?: WorkflowReviewReport,
) {
  const prior = runtime.repeatedFailures?.[nodeId];
  // 人工续跑同一失败记录时不能再累计一次。
  if (prior?.lastAttempt === attempt)
    return prior.consecutive >= REPEATED_FAILURE_LIMIT;
  const signal = report
    ? [
        report.artifact,
        report.revision,
        report.criteria
          .filter((item) => item.outcome !== "passed")
          .map((item) => `${item.id}:${item.outcome}`)
          .sort(),
        report.findings.map((item) => item.criterionId).sort(),
      ]
    : reason.trim().replace(/\s+/g, " ");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(signal))
    .digest("hex");
  const consecutive =
    prior?.fingerprint === fingerprint ? prior.consecutive + 1 : 1;
  runtime.repeatedFailures ??= {};
  runtime.repeatedFailures[nodeId] = {
    fingerprint,
    consecutive,
    lastAttempt: attempt,
    reason: reason.slice(0, 2000),
  };
  return consecutive >= REPEATED_FAILURE_LIMIT;
}
