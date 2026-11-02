import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  agents,
  instanceSettings,
  workflowPolicies,
  workflowRuns,
  workflowTemplateRevisions,
  signalDatabaseWork,
  type Db,
  issues,
} from "@paperclipai/db";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  resolveWorkflowPolicy,
  workflowPolicySchema,
  type WorkflowNodeState,
  type WorkflowPolicy,
  type WorkflowSnapshot,
} from "@paperclipai/shared";
import { z } from "zod";
import { forbidden, unprocessable } from "../../errors.js";
import { persistActivity } from "../activity-log.js";

export const WORKFLOW_QUEUE = "native-workflows";
export const WORKFLOW_SETTINGS_KEY = "native-workflows/v1";
export const workflowPlatformSchema = z
  .object({
    version: z.number().int().positive().default(1),
    policy: workflowPolicySchema.default({}),
    allowHostCommands: z.boolean().default(false),
  })
  .strict();
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function readWorkflowPlatform(db: Db | Transaction) {
  const [row] = await db
    .select({ general: instanceSettings.general })
    .from(instanceSettings)
    .where(eq(instanceSettings.singletonKey, WORKFLOW_SETTINGS_KEY));
  return workflowPlatformSchema.parse(row?.general ?? {});
}

/** Runs in the issue insert transaction. Imports, conversations and child tasks
 * retain their existing lifecycle; snapshots are made only for new execution roots. */
export async function prepareWorkflowAdmission(
  tx: Transaction,
  values: typeof issues.$inferInsert,
  override?: WorkflowPolicy,
  initialPlan?: string | null,
) {
  if (
    values.parentId ||
    values.conversationAgentId ||
    values.harnessKind ||
    (values.workMode && values.workMode !== "standard") ||
    (values.originKind && values.originKind !== "manual") ||
    !values.assigneeAgentId ||
    values.assigneeUserId ||
    ["done", "cancelled"].includes(values.status ?? "")
  )
    return null;
  // Explicit native stages/monitors remain governed by the original engine.
  // A caller cannot use a task-level override to edit the native policy in place.
  if (!values.responsibleUserId) {
    if (override)
      throw unprocessable("Workflow tasks require a responsible user");
    // Legacy/internal tasks without a human execution identity retain their
    // existing lifecycle. Native execution still owns its identity requirements.
    return null;
  }
  if (
    values.createdByAgentId &&
    override &&
    (override.enabled !== undefined ||
      override.templateKey !== undefined ||
      override.revision !== undefined)
  ) {
    throw forbidden(
      "Agents may narrow workflow limits but may not change the inherited template or disable it",
    );
  }
  const platform = await readWorkflowPlatform(tx);
  const policies = await tx
    .select()
    .from(workflowPolicies)
    .where(
      and(
        eq(workflowPolicies.companyId, values.companyId),
        or(
          eq(workflowPolicies.scope, "company"),
          values.projectId
            ? eq(workflowPolicies.projectId, values.projectId)
            : undefined,
        ),
      ),
    )
    .orderBy(asc(workflowPolicies.scope));
  const effective = resolveWorkflowPolicy(
    [...policies.map((row) => row.policy), ...(override ? [override] : [])],
    platform.policy,
  );
  if (!effective.enabled) return null;
  if (values.executionPolicy) {
    if (values.createdByAgentId)
      throw forbidden(
        "Agents cannot bypass the inherited workflow with a separate execution policy",
      );
    return null;
  }
  const [revision] = await tx
    .select()
    .from(workflowTemplateRevisions)
    .where(
      and(
        eq(workflowTemplateRevisions.companyId, values.companyId),
        eq(workflowTemplateRevisions.templateKey, effective.templateKey),
        effective.revision
          ? eq(workflowTemplateRevisions.revision, effective.revision)
          : eq(workflowTemplateRevisions.status, "published"),
      ),
    )
    .orderBy(desc(workflowTemplateRevisions.revision))
    .limit(1);
  if (revision?.status === "draft" && !values.createdByUserId) {
    throw forbidden(
      "Only the board can create an evaluation task against a draft workflow revision",
    );
  }
  const definition =
    revision?.definition ??
    BUILT_IN_WORKFLOW_TEMPLATES.find(
      (template) => template.key === effective.templateKey,
    );
  if (
    !definition ||
    (!revision && effective.revision && effective.revision !== 1)
  ) {
    throw unprocessable(
      "The selected workflow template revision does not exist",
    );
  }
  const roster = await tx
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.companyId, values.companyId),
        inArray(agents.status, [
          "active",
          "idle",
          "paused",
          "running",
          "error",
        ]),
      ),
    )
    .orderBy(asc(agents.createdAt), asc(agents.id));
  const executor = roster.find((agent) => agent.id === values.assigneeAgentId);
  if (!executor)
    throw unprocessable("Workflow executor is not an eligible company agent");
  const nodes: Record<string, WorkflowNodeState> = {};
  for (const node of definition.nodes) {
    let agentId: string | null = null;
    let userId: string | null = null;
    if (node.kind !== "check") {
      if (node.binding.kind === "executor") agentId = executor.id;
      else if (node.binding.kind === "agent") {
        const requestedAgentId = node.binding.agentId;
        agentId =
          roster.find((agent) => agent.id === requestedAgentId)?.id ?? null;
        if (!agentId)
          throw unprocessable(
            `Workflow binding references an unavailable company agent: ${node.id}`,
          );
      } else if (node.binding.kind === "role") {
        const role = node.binding.role;
        agentId =
          roster.find(
            (agent) =>
              agent.role === role &&
              agent.id !== executor.id &&
              agent.status !== "paused",
          )?.id ??
          roster.find(
            (agent) => agent.role === role && agent.id !== executor.id,
          )?.id ??
          null;
      }
      if (node.kind === "review" && agentId === executor.id) agentId = null;
      if (!agentId) userId = values.responsibleUserId;
    }
    nodes[node.id] = {
      status: "pending",
      attempt: 0,
      issueId: null,
      agentId,
      userId,
      startedAt: null,
      finishedAt: null,
      result: null,
    };
  }
  const implementers = new Set(
    definition.nodes
      .filter((node) => node.kind === "task")
      .map((node) => nodes[node.id].agentId),
  );
  for (const node of definition.nodes.filter(
    (node) => node.kind === "review",
  )) {
    if (implementers.has(nodes[node.id].agentId)) {
      nodes[node.id].agentId = null;
      nodes[node.id].userId = values.responsibleUserId;
    }
  }
  const snapshot: WorkflowSnapshot = {
    schemaVersion: 1,
    templateKey: definition.key,
    revisionId: revision?.id ?? null,
    revision: revision?.revision ?? 1,
    definition,
    limits: effective.limits,
    executorAgentId: executor.id,
    responsibleUserId: values.responsibleUserId,
    objective: {
      title: values.title,
      description: values.description ?? null,
      plan: initialPlan ?? null,
    },
    policyVersions: [
      { scope: "platform", version: platform.version },
      ...policies.map((row) => ({
        scope: row.scope as "company" | "project",
        version: row.version,
      })),
      ...(override ? [{ scope: "task" as const, version: 1 }] : []),
    ],
  };
  values.assigneeAgentId = null;
  values.assigneeUserId = values.responsibleUserId;
  return { id: randomUUID(), snapshot, nodes };
}

export async function persistWorkflowAdmission(
  tx: Transaction,
  issue: typeof issues.$inferSelect,
  admission: NonNullable<Awaited<ReturnType<typeof prepareWorkflowAdmission>>>,
) {
  await signalDatabaseWork(tx, WORKFLOW_QUEUE);
  await tx.insert(workflowRuns).values({
    id: admission.id,
    companyId: issue.companyId,
    issueId: issue.id,
    snapshot: admission.snapshot,
    nodes: admission.nodes,
    deadlineAt: new Date(
      Date.now() + admission.snapshot.limits.timeoutMinutes * 60_000,
    ),
  });
  await persistActivity(tx as unknown as Db, {
    companyId: issue.companyId,
    actorType: "system",
    actorId: "native-workflows",
    action: "workflow.admitted",
    entityType: "issue",
    entityId: issue.id,
    details: {
      workflowRunId: admission.id,
      templateKey: admission.snapshot.templateKey,
      revision: admission.snapshot.revision,
      policyVersions: admission.snapshot.policyVersions,
      limits: admission.snapshot.limits,
    },
  });
}
