import { describe, expect, it } from "vitest";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  type WorkflowRuntimeState,
  type WorkflowNodeState,
  type WorkflowSnapshot,
  type WorkflowReviewReport,
} from "@paperclipai/shared";
import {
  settleHumanWait,
  updateHumanWait,
  recordWorkflowFailure,
} from "./runtime.js";

function timedRun() {
  const definition = structuredClone(BUILT_IN_WORKFLOW_TEMPLATES[0]);
  const state = (human: boolean): WorkflowNodeState => ({
    status: "running",
    attempt: 1,
    issueId: "task",
    agentId: human ? null : "agent",
    userId: human ? "user" : null,
    startedAt: null,
    finishedAt: null,
    result: null,
  });
  return {
    status: "running",
    deadlineAt: new Date(60_000),
    runtime: {} as WorkflowRuntimeState,
    snapshot: { definition } as WorkflowSnapshot,
    nodes: {
      review: state(true),
      execute: {
        ...state(false),
        status: "passed" as WorkflowNodeState["status"],
      },
    },
  };
}

describe("工作流停表与重复失败", () => {
  it("纯人工等待跨重启保留剩余时长，结算不能重复增加时间", () => {
    const run = timedRun();
    updateHumanWait(run, 10_000);
    updateHumanWait(run, 20_000);
    expect(run.runtime.humanWaitStartedAt).toBe(new Date(10_000).toISOString());
    const restored = {
      ...run,
      runtime: JSON.parse(JSON.stringify(run.runtime)),
    };
    settleHumanWait(restored, 3_600_000);
    expect(restored.deadlineAt.getTime()).toBe(3_650_000);
    settleHumanWait(restored, 3_700_000);
    expect(restored.deadlineAt.getTime()).toBe(3_650_000);
  });
  it("有并行自动执行时继续计时，无人工活跃阶段时不冻结", () => {
    const run = timedRun();
    run.nodes.execute.status = "running";
    updateHumanWait(run, 10_000);
    expect(run.runtime.humanWaitStartedAt).toBeUndefined();
    run.nodes.execute.status = "passed";
    updateHumanWait(run, 20_000);
    run.nodes.review.status = "passed";
    updateHumanWait(run, 40_000);
    expect(run.deadlineAt.getTime()).toBe(80_000);
    expect(run.runtime.humanWaitStartedAt).toBeUndefined();
  });
  it("纯人工等待切换手动暂停时只归还一次等待时间", () => {
    const run = timedRun();
    updateHumanWait(run, 10_000);
    run.status = "paused";
    updateHumanWait(run, 40_000);
    expect(run.deadlineAt.getTime()).toBe(90_000);
    expect(run.runtime.humanWaitStartedAt).toBeUndefined();
  });
  it("三次相同错误触发停止，同一次回调不重复计数，人工确认后可继续", () => {
    const runtime: WorkflowRuntimeState = {};
    expect(recordWorkflowFailure(runtime, "execute", 1, "build failed")).toBe(
      false,
    );
    expect(recordWorkflowFailure(runtime, "execute", 1, "build failed")).toBe(
      false,
    );
    expect(recordWorkflowFailure(runtime, "execute", 2, "build  failed")).toBe(
      false,
    );
    expect(recordWorkflowFailure(runtime, "execute", 3, "build failed")).toBe(
      true,
    );
    runtime.repeatedFailures!.execute.consecutive = 0;
    expect(recordWorkflowFailure(runtime, "execute", 3, "build failed")).toBe(
      false,
    );
    expect(recordWorkflowFailure(runtime, "execute", 4, "build failed")).toBe(
      false,
    );
  });
  it("版本或失败验收项变化会重置重复计数", () => {
    const runtime: WorkflowRuntimeState = {};
    const report: WorkflowReviewReport = {
      artifact: "output",
      revision: "v1",
      criteria: [
        {
          id: "ac1",
          requirement: "requirement",
          outcome: "failed",
          evidence: "evidence",
        },
      ],
      findings: [
        {
          id: "f1",
          criterionId: "ac1",
          problem: "problem",
          requestedChange: "repair",
        },
      ],
    };
    recordWorkflowFailure(runtime, "review", 1, "first", report);
    recordWorkflowFailure(runtime, "review", 2, "new wording", report);
    expect(runtime.repeatedFailures!.review.consecutive).toBe(2);
    expect(
      recordWorkflowFailure(
        runtime,
        "review",
        3,
        "same failure, new revision",
        { ...report, revision: "v2" },
      ),
    ).toBe(false);
    expect(runtime.repeatedFailures!.review.consecutive).toBe(1);
    expect(
      recordWorkflowFailure(runtime, "review", 4, "different criterion", {
        ...report,
        criteria: [{ ...report.criteria[0], id: "ac2" }],
      }),
    ).toBe(false);
  });
});

it("settles human waits without creating a deadline for unlimited runs", () => {
  const run = { ...timedRun(), deadlineAt: null };
  updateHumanWait(run, 1000);
  settleHumanWait(run, 86400_000);
  expect(run.deadlineAt).toBeNull();
  expect(run.runtime.humanWaitStartedAt).toBeUndefined();
});
