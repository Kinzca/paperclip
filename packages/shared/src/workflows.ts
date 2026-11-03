import { z } from "zod";
import { AGENT_ROLES } from "./constants.js";

const keySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const workflowLimitsSchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10),
    timeoutMinutes: z.number().int().min(1).max(1440),
    maxParallelism: z.number().int().min(1).max(10),
    maxCostCents: z.number().int().positive().max(1_000_000).nullable(),
  })
  .strict();
export type WorkflowLimits = z.infer<typeof workflowLimitsSchema>;

export const workflowBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("executor") }).strict(),
  z.object({ kind: z.literal("role"), role: z.enum(AGENT_ROLES) }).strict(),
  z.object({ kind: z.literal("agent"), agentId: z.string().guid() }).strict(),
  z.object({ kind: z.literal("human") }).strict(),
]);
export type WorkflowBinding = z.infer<typeof workflowBindingSchema>;

export const workflowCheckSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("evidence"),
      required: z
        .array(z.enum(["attachment", "work_product", "successful_run"]))
        .min(1)
        .max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal("command"),
      command: z
        .string()
        .trim()
        .min(1)
        .max(1024)
        .refine(
          (value) => !/[\r\n\0]/.test(value),
          "Command must be a single executable",
        ),
      args: z
        .array(
          z
            .string()
            .max(4096)
            .refine((value) => !value.includes("\0")),
        )
        .max(100),
      timeoutSeconds: z.number().int().min(1).max(1800),
      retrySafe: z.boolean(),
    })
    .strict(),
]);
export type WorkflowCheck = z.infer<typeof workflowCheckSchema>;

export const workflowNodeSchema = z
  .object({
    id: keySchema,
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["task", "check", "review", "approval"]),
    instructions: z.string().max(16000).default(""),
    binding: workflowBindingSchema.default({ kind: "executor" }),
    dependsOn: z.array(keySchema).max(32).default([]),
    onFailure: keySchema.optional(),
    check: workflowCheckSchema.optional(),
  })
  .strict()
  .superRefine((node, ctx) => {
    if ((node.kind === "check") !== Boolean(node.check)) {
      ctx.addIssue({
        code: "custom",
        path: ["check"],
        message: "Only check nodes must declare a check",
      });
    }
    if (node.kind === "approval" && node.binding.kind !== "human") {
      ctx.addIssue({
        code: "custom",
        path: ["binding"],
        message: "Approval nodes must use a human binding",
      });
    }
  });
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowTemplateSchema = z
  .object({
    key: keySchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().max(4000).default(""),
    category: z.enum(["general", "specialist"]).optional(),
    handoffVersion: z.literal(1).optional(),
    improvement: z
      .object({
        applicability: z.string().max(2000),
        evidence: z.string().max(4000),
        hypothesis: z.string().max(2000),
        validation: z.string().max(2000),
      })
      .strict()
      .optional(),
    nodes: z.array(workflowNodeSchema).min(1).max(32),
  })
  .strict()
  .superRefine((template, ctx) => {
    const byId = new Map(template.nodes.map((node) => [node.id, node]));
    if (byId.size !== template.nodes.length) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Node IDs must be unique",
      });
      return;
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ancestors = new Map<string, Set<string>>();
    function visit(id: string): Set<string> {
      if (visiting.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message: "Dependency edges must form an acyclic graph",
        });
        return new Set();
      }
      if (visited.has(id)) return ancestors.get(id)!;
      visiting.add(id);
      const result = new Set<string>();
      for (const dependency of byId.get(id)!.dependsOn) {
        if (!byId.has(dependency)) {
          ctx.addIssue({
            code: "custom",
            path: ["nodes"],
            message: `Unknown dependency: ${dependency}`,
          });
          continue;
        }
        result.add(dependency);
        for (const ancestor of visit(dependency)) result.add(ancestor);
      }
      visiting.delete(id);
      visited.add(id);
      ancestors.set(id, result);
      return result;
    }
    for (const node of template.nodes) visit(node.id);
    for (const node of template.nodes) {
      if (new Set(node.dependsOn).size !== node.dependsOn.length) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `Duplicate dependency on ${node.id}`,
        });
      }
      if (
        node.onFailure &&
        (!ancestors.get(node.id)!.has(node.onFailure) ||
          byId.get(node.onFailure)?.kind !== "task")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes"],
          message: `Repair target for ${node.id} must be an ancestor task node`,
        });
      }
    }
  });
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;

export const workflowPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    templateKey: keySchema.optional(),
    revision: z.number().int().positive().optional(),
    limits: workflowLimitsSchema.partial().optional(),
    context: z.string().trim().max(8000).optional(),
    bindings: z
      .record(keySchema, workflowBindingSchema)
      .refine((value) => Object.keys(value).length <= 32)
      .optional(),
  })
  .strict();
export type WorkflowPolicy = z.infer<typeof workflowPolicySchema>;

export const saveWorkflowPolicySchema = z
  .object({
    scope: z.enum(["company", "project"]),
    projectId: z.string().guid().nullable().default(null),
    expectedVersion: z.number().int().nonnegative(),
    policy: workflowPolicySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.scope === "project") !== Boolean(value.projectId)) {
      ctx.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Only project policies require projectId",
      });
    }
  });
export const createWorkflowRevisionSchema = z
  .object({
    definition: workflowTemplateSchema,
    basedOnRevisionId: z.string().guid().nullable().default(null),
    rationale: z.string().trim().min(1).max(4000),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.definition.improvement)
      for (const [key, value] of Object.entries(input.definition.improvement)) {
        if (!value.trim())
          ctx.addIssue({
            code: "custom",
            path: ["definition", "improvement", key],
            message:
              "Improvement proposals require applicability, evidence, a hypothesis and a validation plan",
          });
      }
  });
export const workflowControlSchema = z
  .object({
    action: z.enum(["pause", "resume", "cancel", "retry"]),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export const workflowReviewReportSchema = z
  .object({
    artifact: z.string().trim().min(1).max(2000),
    revision: z.string().trim().min(1).max(500),
    criteria: z
      .array(
        z
          .object({
            id: keySchema,
            requirement: z.string().trim().min(1).max(2000),
            outcome: z.enum(["passed", "failed", "unverified"]),
            evidence: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    findings: z
      .array(
        z
          .object({
            id: keySchema,
            criterionId: keySchema,
            problem: z.string().trim().min(1).max(2000),
            requestedChange: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((report, ctx) => {
    const ids = new Set(report.criteria.map((item) => item.id));
    if (
      ids.size !== report.criteria.length ||
      new Set(report.findings.map((item) => item.id)).size !==
        report.findings.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Criterion and finding IDs must be unique",
      });
    if (report.findings.some((item) => !ids.has(item.criterionId)))
      ctx.addIssue({
        code: "custom",
        message: "Findings must reference an assessed criterion",
      });
  });
export type WorkflowReviewReport = z.infer<typeof workflowReviewReportSchema>;

export function workflowReviewError(
  outcome: "passed" | "failed",
  report?: WorkflowReviewReport,
): string | null {
  if (!report) return null;
  if (
    outcome === "passed" &&
    (report.findings.length ||
      report.criteria.some((item) => item.outcome !== "passed"))
  )
    return "A passing review must verify every criterion and have no unresolved findings";
  if (outcome === "failed" && !report.findings.length)
    return "A failed review must include actionable findings";
  return null;
}

export const workflowDecisionSchema = z
  .object({
    nodeId: keySchema,
    attempt: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    outcome: z.enum(["passed", "failed"]),
    comment: z.string().trim().min(1).max(16000),
    report: workflowReviewReportSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const message = workflowReviewError(input.outcome, input.report);
    if (message) ctx.addIssue({ code: "custom", path: ["report"], message });
  });
export const workflowEvaluationSchema = z
  .object({
    baselineRunId: z.string().guid(),
    candidateRunId: z.string().guid(),
    scenarioKey: z.string().trim().min(1).max(200),
  })
  .strict();
export const workflowTrialsSchema = z
  .object({
    baselineRunIds: z
      .array(z.string().guid())
      .min(3)
      .max(10)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Baseline runs must be distinct",
      ),
  })
  .strict();

export type WorkflowNodeStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "cancelled";
export interface WorkflowNodeState {
  status: WorkflowNodeStatus;
  attempt: number;
  issueId: string | null;
  agentId: string | null;
  userId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  interrupted?: boolean;
  resumeGeneration?: number;
}
export interface WorkflowSnapshot {
  schemaVersion: 1;
  templateKey: string;
  revisionId: string | null;
  revision: number;
  definition: WorkflowTemplate;
  limits: WorkflowLimits;
  context?: {
    scope: "platform" | "company" | "project" | "task";
    instructions: string;
  }[];
  executorAgentId: string;
  responsibleUserId: string;
  objective: { title: string; description: string | null; plan: string | null };
  policyVersions: {
    scope: "platform" | "company" | "project" | "task";
    version: number;
  }[];
}
export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "waiting_human"
  | "succeeded"
  | "cancelled";
export interface WorkflowRun {
  id: string;
  companyId: string;
  issueId: string;
  status: WorkflowRunStatus;
  version: number;
  snapshot: WorkflowSnapshot;
  nodes: Record<string, WorkflowNodeState>;
  stopReason: string | null;
  deadlineAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowAttempt {
  id: string;
  nodeId: string;
  attempt: number;
  issueId: string | null;
  status: string;
  evidence: Record<string, unknown> | null;
  decisionAgentId: string | null;
  decisionUserId: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface WorkflowRunDetail extends WorkflowRun {
  isRoot: boolean;
  attempts: WorkflowAttempt[];
}
export interface WorkflowEvaluation {
  id: string;
  candidateRevisionId: string;
  baselineRunId: string;
  candidateRunId: string;
  scenarioKey: string;
  passed: boolean;
  findings: string[];
  objectiveTitle?: string;
  baselineIssueId?: string;
  candidateIssueId?: string;
}
export interface WorkflowBaseline {
  id: string;
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string;
  objectiveTitle: string;
  objectiveFingerprint: string;
  createdAt: string;
  finishedAt: string | null;
}
export interface WorkflowBaselinePage {
  items: WorkflowBaseline[];
  hasMore: boolean;
}
export interface WorkflowRevision {
  id: string;
  companyId: string;
  templateKey: string;
  revision: number;
  status: "draft" | "published";
  definition: WorkflowTemplate;
  basedOnRevisionId: string | null;
  rationale: string;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  publishedAt: string | null;
  createdAt: string;
}
export interface WorkflowPolicyRecord {
  id: string;
  companyId: string;
  scope: "company" | "project";
  projectId: string | null;
  version: number;
  policy: WorkflowPolicy;
}

export const DEFAULT_WORKFLOW_LIMITS: Readonly<WorkflowLimits> = {
  maxAttempts: 3,
  timeoutMinutes: 60,
  maxParallelism: 2,
  maxCostCents: null,
};
export const BUILT_IN_WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  workflowTemplateSchema.parse({
    key: "standard",
    category: "general",
    handoffVersion: 1,
    name: "Execute, verify, review",
    description:
      "Bounded execution with a recorded run receipt and independent review.",
    nodes: [
      {
        id: "execute",
        title: "Execute task",
        kind: "task",
        instructions:
          "Complete the parent's authorized objective. Retain inspectable deliverables and verification evidence; never change acceptance criteria to pass.",
      },
      {
        id: "verify",
        title: "Check execution evidence",
        kind: "check",
        dependsOn: ["execute"],
        onFailure: "execute",
        check: { kind: "evidence", required: ["successful_run"] },
      },
      {
        id: "review",
        title: "Independent verification",
        kind: "review",
        dependsOn: ["verify"],
        onFailure: "execute",
        binding: { kind: "role", role: "qa" },
        instructions:
          "Independently verify the exact delivered revision against the parent objective using real tools. Re-run relevant checks. Report concrete evidence and request changes when any required criterion fails. A successful agent process is not proof that tests passed.",
      },
    ],
  }),
  ...[
    {
      key: "application-development",
      name: "Application development",
      description:
        "Deliver an application change with functional evidence and independent review.",
      instructions:
        "先根据任务目标列出交付物、验收条件和实现计划。采用项目已有技术栈实现应用功能，保留具体版本、运行方式、相关测试和用户操作证据。返修逐条回应问题编号；不要扩大范围或降低验收要求。",
      review:
        "依据原始任务逐项核查交付版本，使用实际运行结果检查主要用户流程、接口、数据和回归风险。构建通过不能代替功能证据；未验证项不得标为通过。",
    },
    {
      key: "problem-solving",
      name: "Problem solving",
      description:
        "Reproduce a problem, repair its cause and check for regressions.",
      instructions:
        "记录问题、复现条件、期望结果和现有证据。定位原因后实施有边界的修复，保留修改前后的证据及产物版本。逐条回应审查问题，无法复现或受外部条件阻塞时说明原因。",
      review:
        "按原始问题和验收条件检查修复版本，核对复现步骤、修复效果及相关回归。检查是否仅掩盖症状、删掉检查或扩大范围。未验证的结论必须明确列出。",
    },
    {
      key: "research-analysis",
      name: "Research and analysis",
      description:
        "Answer a research question with traceable sources and independent fact checking.",
      instructions:
        "明确研究问题、范围、时效和交付形式，制定查证计划。优先收集原始来源，区分事实、推断与未知；交付带来源和版本标识的分析报告。返修时逐条补证或纠正，不编造引用。",
      review:
        "逐项检查研究问题是否被回答，核对原始来源、引用与结论是否对应，识别时效问题、遗漏、反例和不确定性。记录实际查阅的证据；不要将代码构建或软件测试作为研究报告的默认验收要求。",
    },
    {
      key: "document-writing",
      name: "Document writing",
      description:
        "Produce a document for its intended audience and verify coverage and consistency.",
      instructions:
        "明确读者、用途、结构、事实来源和验收条件，列出写作计划。交付可访问且带版本标识的文档，说明覆盖范围、引用及未完成项，按问题编号返修。保留用户提供的专有名称和内容。",
      review:
        "对照目标读者和验收要求，检查文档完整性、事实依据、术语一致性、可执行性及可读性。指出具体段落和修改要求；代码任务以外不默认要求构建或测试命令。",
    },
  ].map((task) =>
    workflowTemplateSchema.parse({
      key: task.key,
      name: task.name,
      description: task.description,
      category: "general",
      handoffVersion: 1,
      nodes: [
        {
          id: "execute",
          title: "Plan and execute",
          kind: "task",
          instructions: task.instructions,
        },
        {
          id: "verify",
          title: "Check retained deliverables",
          kind: "check",
          dependsOn: ["execute"],
          onFailure: "execute",
          check: {
            kind: "evidence",
            required: ["successful_run", "work_product"],
          },
        },
        {
          id: "review",
          title: "Independent verification",
          kind: "review",
          dependsOn: ["verify"],
          onFailure: "execute",
          binding: { kind: "role", role: "qa" },
          instructions: task.review,
        },
      ],
    }),
  ),
  workflowTemplateSchema.parse({
    key: "game-development",
    category: "specialist",
    name: "Game development",
    description:
      "Implementation followed by parallel code and playable-result verification.",
    nodes: [
      {
        id: "execute",
        title: "Implement game change",
        kind: "task",
        instructions:
          "Implement the approved game change in the project workspace. Launch the game, exercise the changed behavior, retain screenshots and test evidence, and register work products. Do not choose a new engine or alter the agreed scope.",
      },
      {
        id: "evidence",
        title: "Check retained deliverables",
        kind: "check",
        dependsOn: ["execute"],
        onFailure: "execute",
        check: {
          kind: "evidence",
          required: ["successful_run", "attachment", "work_product"],
        },
      },
      {
        id: "code-review",
        title: "Review implementation",
        kind: "review",
        dependsOn: ["evidence"],
        onFailure: "execute",
        binding: { kind: "role", role: "engineer" },
        instructions:
          "Review the exact delivered implementation and rerun relevant automated tests. Reject regressions and changes to acceptance checks made only to obtain a pass.",
      },
      {
        id: "playtest",
        title: "Verify playable result",
        kind: "review",
        dependsOn: ["evidence"],
        onFailure: "execute",
        binding: { kind: "role", role: "qa" },
        instructions:
          "Launch the exact delivered game revision. Exercise the changed player journey, retain evidence, and check behavior, presentation and usability. Do not infer gameplay success from parse or build success. Escalate unresolved subjective direction to the human.",
      },
      {
        id: "accept",
        title: "Accept game result",
        kind: "approval",
        dependsOn: ["code-review", "playtest"],
        binding: { kind: "human" },
      },
    ],
  }),
];

/** Inheritance narrows ancestor ceilings. Missing overrides never reset them. */
export function resolveWorkflowPolicy(
  overrides: readonly WorkflowPolicy[],
  platform: WorkflowPolicy = {},
) {
  let enabled = platform.enabled ?? true;
  let templateKey = platform.templateKey ?? "standard";
  let revision = platform.revision;
  const limits = { ...DEFAULT_WORKFLOW_LIMITS, ...platform.limits };
  let bindings = { ...platform.bindings };
  const context = platform.context ? [platform.context] : [];
  for (const policy of overrides) {
    if (policy.enabled !== undefined) enabled = enabled && policy.enabled;
    if (policy.templateKey !== undefined) {
      if (policy.templateKey !== templateKey) bindings = {};
      templateKey = policy.templateKey;
      revision = policy.revision;
    } else if (policy.revision !== undefined) revision = policy.revision;
    Object.assign(bindings, policy.bindings);
    if (policy.context) context.push(policy.context);
    if (!policy.limits) continue;
    for (const key of [
      "maxAttempts",
      "timeoutMinutes",
      "maxParallelism",
    ] as const) {
      if (policy.limits[key] !== undefined)
        limits[key] = Math.min(limits[key], policy.limits[key]);
    }
    if (policy.limits.maxCostCents != null) {
      limits.maxCostCents = Math.min(
        limits.maxCostCents ?? Infinity,
        policy.limits.maxCostCents,
      );
    }
  }
  return { enabled, templateKey, revision, limits, bindings, context };
}

export function readyWorkflowNodes(
  definition: WorkflowTemplate,
  nodes: Record<string, WorkflowNodeState>,
  maxParallelism: number,
) {
  const slots = Math.max(
    0,
    maxParallelism -
      Object.values(nodes).filter((node) => node.status === "running").length,
  );
  return definition.nodes
    .filter(
      (node) =>
        nodes[node.id].status === "pending" &&
        node.dependsOn.every((id) => nodes[id].status === "passed"),
    )
    .slice(0, slots);
}

/** Invalidate the repair target and every descendant, never unrelated branches. */
export function workflowRepairNodes(
  definition: WorkflowTemplate,
  targetId: string,
) {
  const reset = new Set([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of definition.nodes) {
      if (!reset.has(node.id) && node.dependsOn.some((id) => reset.has(id))) {
        reset.add(node.id);
        changed = true;
      }
    }
  }
  return [...reset];
}

export function workflowAncestorIds(
  definition: WorkflowTemplate,
  nodeId: string,
) {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const pending = [...byId.get(nodeId)!.dependsOn];
  const ancestors = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    pending.push(...byId.get(id)!.dependsOn);
  }
  return [...ancestors];
}
