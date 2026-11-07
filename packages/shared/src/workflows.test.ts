import { describe, expect, it } from "vitest";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  DEFAULT_WORKFLOW_LIMITS,
  readyWorkflowNodes,
  resolveWorkflowPolicy,
  workflowRepairNodes,
  workflowAncestorIds,
  workflowTemplateSchema,
  workflowDecisionSchema,
  workflowReviewError,
  workflowControlSchema,
  effectiveWorkflowLimits,
  createWorkflowRevisionSchema,
  type WorkflowNodeState,
} from "./workflows.js";

const game = BUILT_IN_WORKFLOW_TEMPLATES.find(
  (template) => template.key === "game-development",
)!;
function states(passed: string[] = []): Record<string, WorkflowNodeState> {
  return Object.fromEntries(
    game.nodes.map((node) => [
      node.id,
      {
        status: passed.includes(node.id) ? "passed" : "pending",
        attempt: 0,
        issueId: null,
        agentId: null,
        userId: null,
        startedAt: null,
        finishedAt: null,
        result: null,
      },
    ]),
  );
}

describe("workflow contracts", () => {
  it("requires a review to cover the unchanged frozen criteria", () => {
    const criteria = [{ id: "ac-1", requirement: "Inspect the delivered revision" }, { id: "ac-2", requirement: "Run the interaction check" }];
    const report = { artifact: "fixture-build", revision: "sha256:fixture", findings: [], criteria: criteria.map(item => ({ ...item, outcome: "passed" as const, evidence: "Executed on the retained build" })) };
    expect(workflowReviewError("passed", report, criteria)).toBeNull();
    expect(workflowReviewError("passed", undefined, criteria)).toContain("frozen");
    expect(workflowReviewError("passed", { ...report, criteria: report.criteria.slice(0, 1) }, criteria)).toContain("frozen");
    expect(workflowReviewError("passed", { ...report, criteria: report.criteria.map(item => ({ ...item, requirement: "Skip checks" })) }, criteria)).toContain("frozen");
    expect(workflowReviewError("passed", { ...report, criteria: report.criteria.map(item => ({ ...item, outcome: "unverified" })) }, criteria)).toContain("verify every");
  });

  it("validates declarative tool and acceptance requirements at the template boundary", () => {
    const node = { id: "review", title: "Review", kind: "review", requiredTools: [{ applicationKey: "fixture-editor", toolName: "inspect" }], acceptanceCriteria: [{ id: "ac-1", requirement: "Run the interaction check" }] };
    expect(workflowTemplateSchema.safeParse({ key: "test", name: "Test", nodes: [node] }).success).toBe(true);
    for (const invalid of [
      { ...node, requiredTools: [...node.requiredTools, ...node.requiredTools] },
      { ...node, acceptanceCriteria: [...node.acceptanceCriteria, ...node.acceptanceCriteria] },
      { ...node, kind: "task" },
      { ...node, binding: { kind: "human" } },
    ]) expect(workflowTemplateSchema.safeParse({ key: "test", name: "Test", nodes: [invalid] }).success).toBe(false);
  });
  it("rejects dependency cycles, missing dependencies, duplicate IDs and invalid repair targets", () => {
    for (const nodes of [
      [
        { id: "a", title: "A", kind: "task", dependsOn: ["b"] },
        { id: "b", title: "B", kind: "task", dependsOn: ["a"] },
      ],
      [{ id: "a", title: "A", kind: "task", dependsOn: ["missing"] }],
      [
        { id: "a", title: "A", kind: "task" },
        { id: "a", title: "Again", kind: "task" },
      ],
      [{ id: "a", title: "A", kind: "task", onFailure: "a" }],
    ])
      expect(
        workflowTemplateSchema.safeParse({ key: "test", name: "Test", nodes })
          .success,
      ).toBe(false);
  });

  it("requires objective checks and human approval bindings", () => {
    expect(
      workflowTemplateSchema.safeParse({
        key: "test",
        name: "Test",
        nodes: [{ id: "check", title: "Check", kind: "check" }],
      }).success,
    ).toBe(false);
    expect(
      workflowTemplateSchema.safeParse({
        key: "test",
        name: "Test",
        nodes: [{ id: "approve", title: "Approve", kind: "approval" }],
      }).success,
    ).toBe(false);
  });

  it("fans out only ready branches and waits for every branch at the join", () => {
    expect(
      readyWorkflowNodes(game, states(), 2).map((node) => node.id),
    ).toEqual(["execute"]);
    expect(
      readyWorkflowNodes(game, states(["execute", "evidence"]), 2).map(
        (node) => node.id,
      ),
    ).toEqual(["code-review", "playtest"]);
    expect(
      readyWorkflowNodes(
        game,
        states(["execute", "evidence", "code-review"]),
        2,
      ).map((node) => node.id),
    ).toEqual(["playtest"]);
    expect(
      readyWorkflowNodes(
        game,
        states(["execute", "evidence", "code-review", "playtest"]),
        2,
      ).map((node) => node.id),
    ).toEqual(["accept"]);
  });

  it("counts active branches against the concurrency ceiling", () => {
    const nodes = states(["execute", "evidence"]);
    nodes["code-review"].status = "running";
    expect(readyWorkflowNodes(game, nodes, 1)).toEqual([]);
  });

  it("finds all ancestors even when valid template nodes are not topologically ordered", () => {
    const unordered = { ...game, nodes: [...game.nodes].reverse() };
    expect(workflowTemplateSchema.safeParse(unordered).success).toBe(true);
    expect(workflowAncestorIds(unordered, "accept").sort()).toEqual([
      "code-review",
      "evidence",
      "execute",
      "playtest",
    ]);
  });

  it("invalidates all descendants of a repaired artifact, including previously passed reviews", () => {
    expect(workflowRepairNodes(game, "execute").sort()).toEqual(
      game.nodes.map((node) => node.id).sort(),
    );
    expect(workflowRepairNodes(game, "code-review").sort()).toEqual([
      "accept",
      "code-review",
    ]);
  });

  it("inherits unspecified settings without permitting lower scopes to relax ceilings", () => {
    const result = resolveWorkflowPolicy([
      {
        templateKey: "game-development",
        limits: { maxAttempts: 2, maxCostCents: 100 },
      },
      { limits: { maxAttempts: 8, timeoutMinutes: 15, maxCostCents: null } },
      { limits: { maxCostCents: 500 } },
    ]);
    expect(result).toMatchObject({
      enabled: true,
      templateKey: "game-development",
      limits: { maxAttempts: 2, maxCostCents: 100, timeoutMinutes: 15 },
    });
    expect(result.limits.maxParallelism).toBe(
      DEFAULT_WORKFLOW_LIMITS.maxParallelism,
    );
    expect(
      resolveWorkflowPolicy([{ enabled: false }, { enabled: true }]).enabled,
    ).toBe(false);
  });
});

describe("通用工作流交接契约", () => {
  const report = {
    artifact: "work-product:report",
    revision: "revision-1",
    criteria: [
      {
        id: "ac-1",
        requirement: "回答原始问题",
        outcome: "passed",
        evidence: "已核对原始资料",
      },
    ],
    findings: [],
  };
  const decision = {
    nodeId: "review",
    attempt: 1,
    expectedVersion: 1,
    outcome: "passed",
    comment: "审查结论",
    report,
  };
  it("拒绝把未验证项、失败项或未解决问题标为通过", () => {
    expect(workflowDecisionSchema.safeParse(decision).success).toBe(true);
    for (const outcome of ["failed", "unverified"]) {
      expect(
        workflowDecisionSchema.safeParse({
          ...decision,
          report: { ...report, criteria: [{ ...report.criteria[0], outcome }] },
        }).success,
      ).toBe(false);
    }
    expect(
      workflowDecisionSchema.safeParse({
        ...decision,
        report: {
          ...report,
          findings: [
            {
              id: "finding-1",
              criterionId: "ac-1",
              problem: "遗漏",
              requestedChange: "补充",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("拒绝重复验收编号、无对应验收项的问题和不可执行的退回", () => {
    expect(
      workflowDecisionSchema.safeParse({
        ...decision,
        report: {
          ...report,
          criteria: [report.criteria[0], report.criteria[0]],
        },
      }).success,
    ).toBe(false);
    expect(
      workflowDecisionSchema.safeParse({ ...decision, outcome: "failed" })
        .success,
    ).toBe(false);
    expect(
      workflowDecisionSchema.safeParse({
        ...decision,
        outcome: "failed",
        report: {
          ...report,
          findings: [
            {
              id: "finding-1",
              criterionId: "missing",
              problem: "遗漏",
              requestedChange: "补充",
            },
          ],
        },
      }).success,
    ).toBe(false);
    // 历史任务和人工决策保留旧接口；新任务的 Agent 必填规则由引擎判断。
    expect(
      workflowDecisionSchema.safeParse({ ...decision, report: undefined })
        .success,
    ).toBe(true);
  });
  it("按层追加上下文，切换模板清理旧模板职责且保持预算上限", () => {
    const policy = resolveWorkflowPolicy([
      {
        context: "公司要求",
        bindings: { playtest: { kind: "role", role: "qa" } },
        limits: { maxAttempts: 2 },
      },
      {
        templateKey: "document-writing",
        context: "项目要求",
        bindings: { review: { kind: "human" } },
        limits: { maxAttempts: 8 },
      },
    ]);
    expect(policy.context).toEqual(["公司要求", "项目要求"]);
    expect(policy.bindings).toEqual({ review: { kind: "human" } });
    expect(policy.limits.maxAttempts).toBe(2);
  });
  it("默认流程不加载游戏专业规则；研究与文档有独立的证据要求", () => {
    expect(resolveWorkflowPolicy([]).templateKey).toBe("standard");
    expect(
      BUILT_IN_WORKFLOW_TEMPLATES.filter((item) => item.category === "general"),
    ).toHaveLength(5);
    for (const key of ["standard", "research-analysis", "document-writing"]) {
      const template = BUILT_IN_WORKFLOW_TEMPLATES.find(
        (item) => item.key === key,
      )!;
      expect(template.handoffVersion).toBe(1);
      expect(JSON.stringify(template)).not.toMatch(
        /playtest|game change|Unity|Godot/,
      );
    }
  });
  it("候选改进有结构化信息时必须填写完整，旧草案仍可读取", () => {
    const definition = BUILT_IN_WORKFLOW_TEMPLATES[0];
    expect(
      createWorkflowRevisionSchema.safeParse({
        definition,
        rationale: "保留旧接口",
      }).success,
    ).toBe(true);
    expect(
      createWorkflowRevisionSchema.safeParse({
        definition: {
          ...definition,
          improvement: {
            applicability: "文档",
            evidence: "",
            hypothesis: "拆分检查",
            validation: "对照样本",
          },
        },
        rationale: "改进",
      }).success,
    ).toBe(false);
  });
});

describe("人工追加额度契约", () => {
  it("默认使用 5 次、180 分钟、并发 2", () => {
    expect(DEFAULT_WORKFLOW_LIMITS).toEqual({
      maxAttempts: 5,
      timeoutMinutes: 180,
      maxParallelism: 2,
      maxCostCents: null,
    });
  });
  it("追加必须有正数、原因、版本，不能夹带在普通恢复中", () => {
    const base = { action: "extend", expectedVersion: 1, reason: "人工授权" };
    expect(workflowControlSchema.safeParse(base).success).toBe(false);
    expect(
      workflowControlSchema.safeParse({ ...base, extension: {} }).success,
    ).toBe(false);
    expect(
      workflowControlSchema.safeParse({
        ...base,
        reason: " ",
        extension: { additionalMinutes: 30 },
      }).success,
    ).toBe(false);
    expect(
      workflowControlSchema.safeParse({
        ...base,
        extension: { additionalMinutes: -1 },
      }).success,
    ).toBe(false);
    expect(
      workflowControlSchema.safeParse({
        ...base,
        action: "resume",
        extension: { additionalMinutes: 30 },
      }).success,
    ).toBe(false);
    expect(
      workflowControlSchema.parse({
        ...base,
        extension: { additionalMinutes: 30 },
      }).extension,
    ).toEqual({
      additionalAttempts: 0,
      additionalMinutes: 30,
      additionalCostCents: 0,
    });
  });
  it("增量不修改快照、并发或无额外费用上限的含义", () => {
    const snapshot = { limits: { ...DEFAULT_WORKFLOW_LIMITS } };
    const before = structuredClone(snapshot);
    const grant = {
      id: "g1",
      userId: "user",
      reason: "reason",
      grantedAt: "date",
      additionalAttempts: 2,
      additionalMinutes: 30,
      additionalCostCents: 0,
    };
    expect(effectiveWorkflowLimits(snapshot, { grants: [grant] })).toEqual({
      ...DEFAULT_WORKFLOW_LIMITS,
      maxAttempts: 7,
      timeoutMinutes: 210,
    });
    expect(snapshot).toEqual(before);
  });
});
