import { describe, expect, it } from "vitest";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  DEFAULT_WORKFLOW_LIMITS,
  readyWorkflowNodes,
  resolveWorkflowPolicy,
  workflowRepairNodes,
  workflowAncestorIds,
  workflowTemplateSchema,
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
