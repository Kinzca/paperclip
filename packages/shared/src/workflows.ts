import { z } from "zod";
import { AGENT_ROLES } from "./constants.js";

const keySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const workflowLimitsSchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10),
    timeoutMinutes: z.number().int().min(1).max(1440).nullable(),
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
    requiredTools: z
      .array(z.object({
        applicationKey: z.string().trim().min(1).max(200),
        toolName: z.string().trim().min(1).max(200),
        /** Local MCP admission inspects explicit per-agent Codex overrides, without invoking tools. */
        transport: z.enum(["profile", "local_mcp"]).optional(),
      }).strict())
      .max(32)
      .optional(),
    acceptanceCriteria: z
      .array(z.object({
        id: keySchema,
        requirement: z.string().trim().min(1).max(2000),
      }).strict())
      .min(1)
      .max(50)
      .optional(),
  })
  .strict()
  .superRefine((node, ctx) => {
    if (node.requiredTools?.length && (node.binding.kind === "human" || !["task", "review"].includes(node.kind))) {
      ctx.addIssue({ code: "custom", path: ["requiredTools"], message: "Tool requirements apply to agent task and review nodes" });
    }
    if (node.requiredTools && new Set(node.requiredTools.map(tool => JSON.stringify([tool.applicationKey, tool.toolName]))).size !== node.requiredTools.length) {
      ctx.addIssue({ code: "custom", path: ["requiredTools"], message: "Tool requirements must be unique" });
    }
    if (node.acceptanceCriteria && (node.kind !== "review" || new Set(node.acceptanceCriteria.map(item => item.id)).size !== node.acceptanceCriteria.length)) {
      ctx.addIssue({ code: "custom", path: ["acceptanceCriteria"], message: "Only review nodes may declare unique acceptance criteria" });
    }
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

export const workflowPlatformUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    policy: workflowPolicySchema,
    allowHostCommands: z.boolean(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      Object.values(input.policy.bindings ?? {}).some(
        (binding) => binding.kind === "agent",
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["policy", "bindings"],
        message: "Instance defaults cannot pin company-specific agents",
      });
  });

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
export const workflowBudgetExtensionSchema = z
  .object({
    additionalAttempts: z.number().int().min(0).max(9).default(0),
    additionalMinutes: z.number().int().min(0).max(1439).default(0),
    additionalCostCents: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()
  .refine((value) => Object.values(value).some((amount) => amount > 0), {
    message: "Add at least one positive allowance",
  });
export type WorkflowBudgetExtension = z.infer<
  typeof workflowBudgetExtensionSchema
>;
export const workflowControlSchema = z
  .object({
    action: z.enum(["pause", "resume", "resume_unlimited", "cancel", "retry", "extend"]),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
    extension: workflowBudgetExtensionSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if ((input.action === "extend") !== !!input.extension)
      ctx.addIssue({
        code: "custom",
        path: ["extension"],
        message: "Only extend requires an allowance",
      });
  });
export type WorkflowControl = z.infer<typeof workflowControlSchema>;
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
  criteria?: WorkflowNode["acceptanceCriteria"],
): string | null {
  if (
    criteria &&
    (!report || report.criteria.length !== criteria.length || criteria.some(expected =>
      !report.criteria.some(actual => actual.id === expected.id && actual.requirement === expected.requirement)
    ))
  )
    return "The review must assess every frozen acceptance criterion without changing its requirement";
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
  /** Durable event identities; never an authorization to answer an interaction. */
  delegatedWait?: {
    kind: "dependencies" | "agent_interaction" | "human_interaction";
    issueIds: string[];
    interactionIds: string[];
  };
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
export interface WorkflowBudgetGrant extends WorkflowBudgetExtension {
  id: string;
  userId: string;
  reason: string;
  grantedAt: string;
}
export interface WorkflowRuntimeState {
  timeLimitRemoval?: { userId: string; reason: string; grantedAt: string };
  humanWaitStartedAt?: string;
  grants?: WorkflowBudgetGrant[];
  repeatedFailures?: Record<
    string,
    {
      fingerprint: string;
      consecutive: number;
      lastAttempt: number;
      reason: string;
    }
  >;
}
/** 原始快照不变；只有经过人工授权的增量影响当前运行。 */
export function effectiveWorkflowLimits(
  snapshot: Pick<WorkflowSnapshot, "limits">,
  runtime: WorkflowRuntimeState = {},
): WorkflowLimits {
  return (runtime.grants ?? []).reduce(
    (limits, grant) => ({
      ...limits,
      maxAttempts: limits.maxAttempts + grant.additionalAttempts,
      timeoutMinutes: limits.timeoutMinutes === null
        ? null
        : limits.timeoutMinutes + grant.additionalMinutes,
      maxCostCents:
        limits.maxCostCents == null
          ? null
          : limits.maxCostCents + grant.additionalCostCents,
    }),
    { ...snapshot.limits, ...(runtime.timeLimitRemoval ? { timeoutMinutes: null } : {}) },
  );
}
export interface WorkflowRun {
  id: string;
  companyId: string;
  issueId: string;
  status: WorkflowRunStatus;
  version: number;
  snapshot: WorkflowSnapshot;
  runtime?: WorkflowRuntimeState;
  nodes: Record<string, WorkflowNodeState>;
  stopReason: string | null;
  deadlineAt: string | null;
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
  maxAttempts: 5,
  timeoutMinutes: null,
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
      "Opt-in execution and independent review; shared instructions govern testing.",
    nodes: [
      {
        id: "execute",
        title: "Execute task",
        kind: "task",
        instructions:
          "Complete the authorized objective under the shared execution instructions. Reuse existing evidence, identify the delivered revision and state what remains unverified. Keep the agreed acceptance criteria.",
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
          "Review the delivered revision against the objective using existing evidence and a brief inspection. Follow shared execution instructions for any tests; selecting this review workflow does not authorize extra tests. State unverified criteria and actionable findings without claiming unperformed checks.",
      },
    ],
  }),
  workflowTemplateSchema.parse({
    key: "rapid-development",
    category: "general",
    handoffVersion: 1,
    name: "Rapid development",
    description:
      "Direct delivery by the executor, without automatic testing or independent review.",
    nodes: [
      {
        id: "execute",
        title: "Execute task",
        kind: "task",
        instructions:
          "Complete the authorized objective and deliver directly under the shared execution instructions. Do not add testing or independent review stages. If the user explicitly requires independent review, report that a review workflow must be selected; do not silently change this workflow.",
      },
    ],
  }),
  ...[
    {
      key: "application-development",
      name: "Application development",
      description:
        "Opt-in application implementation and independent review under shared execution instructions.",
      instructions:
        "Implement the authorized application change using the existing stack and shared execution instructions. Identify the changed files or revision, reuse existing evidence and state remaining limitations. Do not expand scope or weaken acceptance criteria.",
      review:
        "Inspect the delivered application change against the agreed criteria and available evidence. Follow shared execution instructions; do not add tests or runtime sessions solely for review evidence. Identify concrete defects and unverified behavior.",
    },
    {
      key: "problem-solving",
      name: "Problem solving",
      description:
        "Opt-in problem repair and independent review under shared execution instructions.",
      instructions:
        "Use the reported symptoms and existing evidence to identify and repair the cause within scope. Follow shared execution instructions; do not create a reproduction or regression suite by default. Describe the fix, remaining uncertainty and any real blocker.",
      review:
        "Inspect whether the repair addresses the reported cause without masking symptoms or expanding scope. Reuse available evidence and follow shared execution instructions for tests. State concrete findings and unverified outcomes.",
    },
    {
      key: "research-analysis",
      name: "Research and analysis",
      description:
        "Opt-in research and independent source review under shared execution instructions.",
      instructions:
        "Answer the research question within its scope and time requirements. Prefer primary sources, distinguish facts from inference and uncertainty, and cite supporting sources. Follow shared execution instructions and do not fabricate references.",
      review:
        "Review whether the research answers the question and whether sources support its conclusions. Identify stale information, omissions and uncertainty. Follow shared execution instructions without adding software tests or evidence-only reports.",
    },
    {
      key: "document-writing",
      name: "Document writing",
      description:
        "Opt-in document writing and independent editorial review under shared execution instructions.",
      instructions:
        "Write the requested document for its audience and purpose, preserving user-provided names and content. Cite factual sources where needed and state omissions. Follow shared execution instructions; use existing delivery mechanisms without extra verification stages.",
      review:
        "Review the document for coverage, factual support, consistent terms and readability. Give specific passage-level findings under the shared execution instructions. Do not add builds, tests or separate evidence collection by default.",
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
      "Opt-in game implementation, code review and playtesting with human acceptance.",
    nodes: [
      {
        id: "execute",
        title: "Implement game change",
        kind: "task",
        instructions:
          "Implement the approved game change in the existing project and engine under the shared execution instructions. Deliver the changed assets or code and reuse existing evidence. Do not launch the game, record video or take screenshots unless the user explicitly requests that work.",
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
          "Inspect the delivered game implementation and available evidence under the shared execution instructions. Do not rerun tests merely because this is a review stage. Identify concrete defects without weakening acceptance criteria.",
      },
      {
        id: "playtest",
        title: "Verify playable result",
        kind: "review",
        dependsOn: ["evidence"],
        onFailure: "execute",
        binding: { kind: "role", role: "qa" },
        instructions:
          "Perform the playtesting explicitly requested by selecting this workflow, limited to the agreed player journey. Follow shared execution instructions; do not add automated tests or recordings unless requested. Use the delivered revision, state unverified behavior and refer unresolved subjective decisions to the user.",
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
  let templateKey = platform.templateKey ?? "rapid-development";
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
      "maxParallelism",
    ] as const) {
      if (policy.limits[key] !== undefined)
        limits[key] = Math.min(limits[key], policy.limits[key]);
    }
    if (policy.limits.timeoutMinutes != null) {
      limits.timeoutMinutes = Math.min(
        limits.timeoutMinutes ?? Infinity,
        policy.limits.timeoutMinutes,
      );
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
