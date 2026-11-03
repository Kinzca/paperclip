import { describe, expect, it } from "vitest";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowSnapshot,
} from "@paperclipai/shared";
import {
  workflowHandoffInstructions,
  workflowReviewFeedback,
} from "./handoff.js";
const snapshot: WorkflowSnapshot = {
  schemaVersion: 1,
  templateKey: "standard",
  revisionId: null,
  revision: 1,
  definition: BUILT_IN_WORKFLOW_TEMPLATES[0],
  limits: { ...DEFAULT_WORKFLOW_LIMITS },
  executorAgentId: "executor",
  responsibleUserId: "owner",
  objective: { title: "研究", description: null, plan: null },
  policyVersions: [],
};
describe("任务交接", () => {
  it("新任务下发结构化审查要求及冻结的项目上下文", () => {
    const text = workflowHandoffInstructions(
      {
        ...snapshot,
        context: [{ scope: "project", instructions: "使用项目引用规范" }],
      },
      snapshot.definition.nodes[2],
    );
    expect(text).toContain("使用项目引用规范");
    expect(text).toContain("report 对象");
    expect(text).toContain("未验证");
  });
  it("旧快照不追加新交接协议", () => {
    expect(
      workflowHandoffInstructions(
        {
          ...snapshot,
          definition: { ...snapshot.definition, handoffVersion: undefined },
        },
        snapshot.definition.nodes[2],
      ),
    ).toBe("");
  });
  it("返修收到问题编号、验收依据和具体修改要求", () => {
    expect(
      workflowReviewFeedback("退回", {
        artifact: "报告",
        revision: "r1",
        criteria: [
          {
            id: "ac-1",
            requirement: "注明来源",
            outcome: "failed",
            evidence: "第2段没有引用",
          },
        ],
        findings: [
          {
            id: "finding-1",
            criterionId: "ac-1",
            problem: "无引用",
            requestedChange: "补充原始资料链接",
          },
        ],
      }),
    ).toContain("[finding-1] 验收项 ac-1：无引用");
  });
});
