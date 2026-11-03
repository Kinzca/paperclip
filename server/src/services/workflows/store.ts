import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agents,
  companies,
  projects,
  issues,
  workflowPolicies,
  workflowRuns,
  workflowTemplateRevisions,
  workflowEvaluations,
  signalDatabaseWork,
  type Db,
} from "@paperclipai/db";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  resolveWorkflowPolicy,
  workflowTemplateSchema,
  type WorkflowTemplate,
  type WorkflowPolicy,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { workflowTransaction } from "./transaction.js";
import { issueService } from "../issues.js";
import { readWorkflowPlatform, WORKFLOW_QUEUE } from "./admission.js";

export function workflowStore(db: Db) {
  return {
    async templates(companyId: string) {
      const revisions = await db
        .select()
        .from(workflowTemplateRevisions)
        .where(eq(workflowTemplateRevisions.companyId, companyId))
        .orderBy(
          asc(workflowTemplateRevisions.templateKey),
          desc(workflowTemplateRevisions.revision),
        );
      return { builtIn: BUILT_IN_WORKFLOW_TEMPLATES, revisions };
    },
    policies: (companyId: string) =>
      db
        .select()
        .from(workflowPolicies)
        .where(eq(workflowPolicies.companyId, companyId)),
    async markCompanyChanged(companyId: string) {
      await db.transaction(async (tx) => {
        await signalDatabaseWork(tx, WORKFLOW_QUEUE);
        await tx
          .update(workflowRuns)
          .set({ needsReconcile: true })
          .where(
            and(
              eq(workflowRuns.companyId, companyId),
              inArray(workflowRuns.status, [
                "pending",
                "running",
                "paused",
                "waiting_human",
              ]),
            ),
          );
      });
    },
    async startTrials(
      companyId: string,
      revisionId: string,
      baselineRunIds: string[],
      userId: string,
    ) {
      return workflowTransaction(db, async (context) => {
        const { tx } = context;
        await tx
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("update");
        const [revision] = await tx
          .select()
          .from(workflowTemplateRevisions)
          .where(
            and(
              eq(workflowTemplateRevisions.id, revisionId),
              eq(workflowTemplateRevisions.companyId, companyId),
            ),
          )
          .for("update");
        if (!revision || revision.status !== "draft")
          throw unprocessable("Select a draft revision for regression trials");
        const baselines = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.companyId, companyId),
              inArray(workflowRuns.id, baselineRunIds),
            ),
          );
        if (
          baselines.length !== baselineRunIds.length ||
          baselines.some(
            (run) =>
              run.status !== "succeeded" ||
              (revision.basedOnRevisionId
                ? run.snapshot.revisionId !== revision.basedOnRevisionId
                : run.snapshot.revisionId !== null ||
                  run.snapshot.templateKey !==
                    (BUILT_IN_WORKFLOW_TEMPLATES.some(
                      (template) => template.key === revision.templateKey,
                    )
                      ? revision.templateKey
                      : "standard")),
          )
        )
          throw unprocessable(
            "Every baseline must be a successful run of the current published template",
          );
        const fingerprints = baselines.map((run) =>
          createHash("sha256")
            .update(JSON.stringify(run.snapshot.objective))
            .digest("hex"),
        );
        if (new Set(fingerprints).size !== fingerprints.length)
          throw unprocessable(
            "Regression trials require distinct immutable objectives",
          );
        const trials = [];
        for (const baselineId of baselineRunIds) {
          const baseline = baselines.find((run) => run.id === baselineId)!;
          const [source] = await tx
            .select()
            .from(issues)
            .where(
              and(
                eq(issues.id, baseline.issueId),
                eq(issues.companyId, companyId),
              ),
            );
          if (!source) throw notFound("Baseline task not found");
          const task = await issueService(db).create(
            companyId,
            {
              title: baseline.snapshot.objective.title,
              description: baseline.snapshot.objective.description,
              initialPlan: baseline.snapshot.objective.plan,
              projectId: source.projectId,
              projectWorkspaceId: source.projectWorkspaceId,
              goalId: source.goalId,
              visibility: source.visibility as "open" | "private",
              priority: source.priority,
              status: "todo",
              createdByUserId: userId,
              responsibleUserId: source.responsibleUserId,
              assigneeAgentId: baseline.snapshot.executorAgentId,
              workflow: {
                templateKey: revision.templateKey,
                revision: revision.revision,
              },
              idempotencyKey: `workflow-trial:${revision.id}:${baseline.id}`,
            },
            tx,
          );
          const [candidate] = await tx
            .select()
            .from(workflowRuns)
            .where(
              and(
                eq(workflowRuns.issueId, task.id),
                eq(workflowRuns.companyId, companyId),
              ),
            );
          if (!candidate || candidate.snapshot.revisionId !== revisionId)
            throw unprocessable(
              "Inherited policy must permit this candidate trial",
            );
          const scenarioKey = createHash("sha256")
            .update(JSON.stringify(baseline.snapshot.objective))
            .digest("hex");
          await tx
            .insert(workflowEvaluations)
            .values({
              companyId,
              candidateRevisionId: revisionId,
              baselineRunId: baseline.id,
              candidateRunId: candidate.id,
              scenarioKey,
              passed: false,
              findings: ["Candidate execution pending"],
              createdByUserId: userId,
            })
            .onConflictDoNothing();
          trials.push({ issueId: task.id, runId: candidate.id });
        }
        await context.activity({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "workflow.trials_started",
          entityType: "workflow_revision",
          entityId: revisionId,
          details: { baselineRunIds, trials },
        });
        return trials;
      });
    },
    async savePolicy(
      companyId: string,
      input: {
        scope: "company" | "project";
        projectId: string | null;
        expectedVersion: number;
        policy: WorkflowPolicy;
      },
      userId: string,
    ) {
      return workflowTransaction(db, async (context) => {
        const { tx } = context;
        // Shared company lock orders configuration changes and template revision numbers.
        const [company] = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("update");
        if (!company) throw notFound("Company not found");
        if (input.projectId) {
          const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.companyId, companyId),
                eq(projects.id, input.projectId),
              ),
            );
          if (!project) throw notFound("Project not found");
        }
        const predicate = and(
          eq(workflowPolicies.companyId, companyId),
          eq(workflowPolicies.scope, input.scope),
          input.projectId
            ? eq(workflowPolicies.projectId, input.projectId)
            : undefined,
        );
        const [current] = await tx
          .select()
          .from(workflowPolicies)
          .where(predicate);
        if ((current?.version ?? 0) !== input.expectedVersion)
          throw conflict("Workflow policy changed; reload before saving");
        if (input.policy.templateKey) {
          const [custom] = await tx
            .select({ id: workflowTemplateRevisions.id })
            .from(workflowTemplateRevisions)
            .where(
              and(
                eq(workflowTemplateRevisions.companyId, companyId),
                eq(
                  workflowTemplateRevisions.templateKey,
                  input.policy.templateKey,
                ),
                eq(workflowTemplateRevisions.status, "published"),
                input.policy.revision
                  ? eq(
                      workflowTemplateRevisions.revision,
                      input.policy.revision,
                    )
                  : undefined,
              ),
            );
          if (
            !custom &&
            !BUILT_IN_WORKFLOW_TEMPLATES.some(
              (template) =>
                template.key === input.policy.templateKey &&
                (!input.policy.revision || input.policy.revision === 1),
            )
          )
            throw unprocessable(
              "Scope defaults must use an available published template",
            );
        }
        // 保存时检查职责绑定，避免无效规则在后续创建任务时才暴露。
        const platform = await readWorkflowPlatform(tx);
        const parents =
          input.scope === "project"
            ? await tx
                .select()
                .from(workflowPolicies)
                .where(
                  and(
                    eq(workflowPolicies.companyId, companyId),
                    eq(workflowPolicies.scope, "company"),
                  ),
                )
            : [];
        const effective = resolveWorkflowPolicy(
          [...parents.map((row) => row.policy), input.policy],
          platform.policy,
        );
        const [revision] = await tx
          .select()
          .from(workflowTemplateRevisions)
          .where(
            and(
              eq(workflowTemplateRevisions.companyId, companyId),
              eq(workflowTemplateRevisions.templateKey, effective.templateKey),
              eq(workflowTemplateRevisions.status, "published"),
              effective.revision
                ? eq(workflowTemplateRevisions.revision, effective.revision)
                : undefined,
            ),
          )
          .orderBy(desc(workflowTemplateRevisions.revision))
          .limit(1);
        const definition =
          revision?.definition ??
          BUILT_IN_WORKFLOW_TEMPLATES.find(
            (item) => item.key === effective.templateKey,
          );
        if (!definition)
          throw unprocessable("The inherited workflow template is unavailable");
        for (const [id, binding] of Object.entries(effective.bindings)) {
          const node = definition.nodes.find((item) => item.id === id);
          if (
            !node ||
            node.kind === "check" ||
            (node.kind === "review" && binding.kind === "executor")
          )
            throw unprocessable(`Invalid workflow binding: ${id}`);
          if (binding.kind === "agent") {
            const [agent] = await tx
              .select({ id: agents.id })
              .from(agents)
              .where(
                and(
                  eq(agents.id, binding.agentId),
                  eq(agents.companyId, companyId),
                ),
              );
            if (!agent)
              throw unprocessable(
                "Workflow bindings must reference an agent in this company",
              );
          }
        }
        if (
          !workflowTemplateSchema.safeParse({
            ...definition,
            nodes: definition.nodes.map((node) => ({
              ...node,
              binding: effective.bindings[node.id] ?? node.binding,
            })),
          }).success
        )
          throw unprocessable("Invalid workflow stage bindings");
        const values = {
          companyId,
          scope: input.scope,
          projectId: input.projectId,
          policy: input.policy,
          version: (current?.version ?? 0) + 1,
          updatedAt: new Date(),
        };
        const [saved] = current
          ? await tx
              .update(workflowPolicies)
              .set(values)
              .where(eq(workflowPolicies.id, current.id))
              .returning()
          : await tx.insert(workflowPolicies).values(values).returning();
        await context.activity({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "workflow.policy_updated",
          entityType: "workflow_policy",
          entityId: saved.id,
          details: {
            scope: input.scope,
            projectId: input.projectId,
            version: saved.version,
          },
        });
        return saved;
      });
    },
    async propose(
      companyId: string,
      input: {
        definition: WorkflowTemplate;
        basedOnRevisionId: string | null;
        rationale: string;
      },
      actor: { userId: string | null; agentId: string | null },
    ) {
      return workflowTransaction(db, async (context) => {
        const { tx } = context;
        await tx
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("update");
        if (input.basedOnRevisionId) {
          const [base] = await tx
            .select()
            .from(workflowTemplateRevisions)
            .where(
              and(
                eq(workflowTemplateRevisions.companyId, companyId),
                eq(workflowTemplateRevisions.id, input.basedOnRevisionId),
              ),
            );
          if (
            !base ||
            base.templateKey !== input.definition.key ||
            base.status !== "published"
          )
            throw unprocessable(
              "The base revision must be published and belong to this company and template",
            );
        }
        const [published] = await tx
          .select()
          .from(workflowTemplateRevisions)
          .where(
            and(
              eq(workflowTemplateRevisions.companyId, companyId),
              eq(workflowTemplateRevisions.templateKey, input.definition.key),
              eq(workflowTemplateRevisions.status, "published"),
            ),
          )
          .orderBy(desc(workflowTemplateRevisions.revision))
          .limit(1);
        if (
          published &&
          input.basedOnRevisionId &&
          input.basedOnRevisionId !== published.id
        )
          throw conflict("Propose against the current published revision");
        const base =
          published?.definition ??
          BUILT_IN_WORKFLOW_TEMPLATES.find(
            (template) => template.key === input.definition.key,
          ) ??
          BUILT_IN_WORKFLOW_TEMPLATES[0];
        if (
          base.handoffVersion &&
          input.definition.handoffVersion !== base.handoffVersion
        )
          throw unprocessable(
            "The baseline handoff protocol must remain fixed",
          );
        if (base.category && input.definition.category !== base.category)
          throw unprocessable(
            "The baseline applicability category must remain fixed",
          );
        for (const node of base.nodes.filter((node) =>
          ["check", "review", "approval"].includes(node.kind),
        )) {
          const candidate = input.definition.nodes.find(
            (item) => item.id === node.id,
          );
          if (!candidate || candidate.kind !== node.kind)
            throw unprocessable(
              `A proposal cannot remove the baseline verification gate: ${node.id}`,
            );
          if (candidate.instructions !== node.instructions)
            throw unprocessable(
              `Baseline acceptance instructions must remain fixed: ${node.id}`,
            );
          if (
            node.kind === "check" &&
            JSON.stringify(candidate.check) !== JSON.stringify(node.check)
          )
            throw unprocessable(
              `The acceptance check is fixed across workflow optimization: ${node.id}`,
            );
          if (node.kind === "approval" && candidate.binding.kind !== "human")
            throw unprocessable(
              "Human approval cannot be delegated to a model",
            );
          if (node.kind === "review" && candidate.binding.kind === "executor")
            throw unprocessable(
              "Independent review cannot become executor self-review",
            );
          if (node.dependsOn.some((id) => !candidate.dependsOn.includes(id)))
            throw unprocessable(
              `A proposal cannot bypass baseline dependencies: ${node.id}`,
            );
        }
        if (
          actor.agentId &&
          input.definition.nodes.some(
            (node) =>
              node.check?.kind === "command" &&
              JSON.stringify(node.check) !==
                JSON.stringify(
                  base.nodes.find((item) => item.id === node.id)?.check,
                ),
          )
        )
          throw forbidden(
            "New host commands require a board-authored proposal",
          );
        const [latest] = await tx
          .select({ revision: workflowTemplateRevisions.revision })
          .from(workflowTemplateRevisions)
          .where(
            and(
              eq(workflowTemplateRevisions.companyId, companyId),
              eq(workflowTemplateRevisions.templateKey, input.definition.key),
            ),
          )
          .orderBy(desc(workflowTemplateRevisions.revision))
          .limit(1);
        const [revision] = await tx
          .insert(workflowTemplateRevisions)
          .values({
            companyId,
            templateKey: input.definition.key,
            revision:
              (latest?.revision ??
                (BUILT_IN_WORKFLOW_TEMPLATES.some(
                  (template) => template.key === input.definition.key,
                )
                  ? 1
                  : 0)) + 1,
            definition: input.definition,
            basedOnRevisionId: published?.id ?? input.basedOnRevisionId,
            rationale: input.rationale,
            createdByUserId: actor.userId,
            createdByAgentId: actor.agentId,
          })
          .returning();
        await context.activity({
          companyId,
          actorType: actor.agentId ? "agent" : "user",
          actorId: actor.agentId ?? actor.userId!,
          agentId: actor.agentId,
          action: "workflow.revision_proposed",
          entityType: "workflow_revision",
          entityId: revision.id,
          details: {
            templateKey: revision.templateKey,
            revision: revision.revision,
          },
        });
        return revision;
      });
    },
    async evaluate(
      companyId: string,
      revisionId: string,
      input: {
        baselineRunId: string;
        candidateRunId: string;
        scenarioKey: string;
      },
      userId: string,
    ) {
      return workflowTransaction(db, async (context) => {
        const { tx } = context;
        const [revision] = await tx
          .select()
          .from(workflowTemplateRevisions)
          .where(
            and(
              eq(workflowTemplateRevisions.companyId, companyId),
              eq(workflowTemplateRevisions.id, revisionId),
            ),
          )
          .for("update");
        if (!revision) throw notFound("Workflow revision not found");
        if (revision.status !== "draft")
          throw conflict("Published revision evaluations are immutable");
        const trials = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.companyId, companyId),
              inArray(workflowRuns.id, [
                input.baselineRunId,
                input.candidateRunId,
              ]),
            ),
          );
        const baseline = trials.find((run) => run.id === input.baselineRunId);
        const candidate = trials.find((run) => run.id === input.candidateRunId);
        if (
          !baseline ||
          !candidate ||
          baseline.id === candidate.id ||
          candidate.snapshot.revisionId !== revisionId ||
          (revision.basedOnRevisionId
            ? baseline.snapshot.revisionId !== revision.basedOnRevisionId
            : baseline.snapshot.revisionId !== null ||
              baseline.snapshot.templateKey !==
                (BUILT_IN_WORKFLOW_TEMPLATES.some(
                  (template) => template.key === revision.templateKey,
                )
                  ? revision.templateKey
                  : "standard"))
        )
          throw unprocessable(
            "Evaluation requires distinct baseline and candidate runs for the selected revision",
          );
        const fingerprint = (run: typeof baseline) =>
          createHash("sha256")
            .update(JSON.stringify(run.snapshot.objective))
            .digest("hex");
        if (fingerprint(baseline) !== fingerprint(candidate))
          throw unprocessable(
            "Baseline and candidate must use the same immutable task objective",
          );
        const scenarioKey = fingerprint(baseline);
        const findings: string[] = [];
        if (
          JSON.stringify(baseline.snapshot.context ?? []) !==
          JSON.stringify(candidate.snapshot.context ?? [])
        )
          findings.push(
            "Execution context changed between baseline and candidate",
          );
        if (
          JSON.stringify(baseline.snapshot.limits) !==
          JSON.stringify(candidate.snapshot.limits)
        )
          findings.push(
            "Execution limits changed between baseline and candidate",
          );
        if (
          baseline.snapshot.executorAgentId !==
          candidate.snapshot.executorAgentId
        )
          findings.push("Executor changed between baseline and candidate");
        for (const node of baseline.snapshot.definition.nodes.filter(
          (item) => item.kind === "review" || item.kind === "approval",
        )) {
          if (
            baseline.nodes[node.id]?.agentId !==
              candidate.nodes[node.id]?.agentId ||
            baseline.nodes[node.id]?.userId !== candidate.nodes[node.id]?.userId
          )
            findings.push(
              `Reviewer changed between baseline and candidate: ${node.id}`,
            );
        }
        if (baseline.status !== "succeeded")
          findings.push("Baseline did not pass its acceptance gates");
        if (candidate.status !== "succeeded")
          findings.push("Candidate did not pass its acceptance gates");
        const retries = (run: typeof baseline) =>
          Object.values(run.nodes).reduce(
            (total, node) => total + Math.max(0, node.attempt - 1),
            0,
          );
        if (retries(candidate) > retries(baseline))
          findings.push(
            "Candidate required more repair attempts than baseline",
          );
        const [evaluation] = await tx
          .insert(workflowEvaluations)
          .values({
            companyId,
            candidateRevisionId: revisionId,
            baselineRunId: baseline.id,
            candidateRunId: candidate.id,
            scenarioKey,
            passed: findings.length === 0,
            findings,
            createdByUserId: userId,
          })
          .onConflictDoUpdate({
            target: [
              workflowEvaluations.candidateRevisionId,
              workflowEvaluations.scenarioKey,
            ],
            set: {
              baselineRunId: baseline.id,
              candidateRunId: candidate.id,
              passed: findings.length === 0,
              findings,
              createdByUserId: userId,
              createdAt: new Date(),
            },
          })
          .returning();
        await context.activity({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "workflow.revision_evaluated",
          entityType: "workflow_revision",
          entityId: revisionId,
          details: {
            evaluationId: evaluation.id,
            scenarioKey: input.scenarioKey,
            passed: evaluation.passed,
          },
        });
        return evaluation;
      });
    },
    async publish(companyId: string, revisionId: string, userId: string) {
      return workflowTransaction(db, async (context) => {
        const { tx } = context;
        await tx
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("update");
        const [revision] = await tx
          .select()
          .from(workflowTemplateRevisions)
          .where(
            and(
              eq(workflowTemplateRevisions.companyId, companyId),
              eq(workflowTemplateRevisions.id, revisionId),
            ),
          )
          .for("update");
        if (!revision) throw notFound("Workflow revision not found");
        if (revision.status === "published") return revision;
        const [current] = await tx
          .select({ id: workflowTemplateRevisions.id })
          .from(workflowTemplateRevisions)
          .where(
            and(
              eq(workflowTemplateRevisions.companyId, companyId),
              eq(workflowTemplateRevisions.templateKey, revision.templateKey),
              eq(workflowTemplateRevisions.status, "published"),
            ),
          )
          .orderBy(desc(workflowTemplateRevisions.revision))
          .limit(1);
        if ((current?.id ?? null) !== revision.basedOnRevisionId)
          throw conflict(
            "The published baseline changed; propose and evaluate a new revision",
          );
        const trials = await tx
          .select()
          .from(workflowEvaluations)
          .where(
            and(
              eq(workflowEvaluations.companyId, companyId),
              eq(workflowEvaluations.candidateRevisionId, revisionId),
            ),
          );
        if (trials.length < 3 || trials.some((trial) => !trial.passed))
          throw unprocessable(
            "Publication requires at least three distinct passing regression scenarios and no failed scenario",
          );
        const [published] = await tx
          .update(workflowTemplateRevisions)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(workflowTemplateRevisions.id, revisionId))
          .returning();
        await context.activity({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "workflow.revision_published",
          entityType: "workflow_revision",
          entityId: revisionId,
          details: {
            templateKey: revision.templateKey,
            revision: revision.revision,
          },
        });
        return published;
      });
    },
    async markIssueChanged(companyId: string, issueId: string) {
      await workflowTransaction(db, async (context) => {
        const { tx } = context;
        const [issue] = await tx
          .select({ originKind: issues.originKind, originId: issues.originId })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
        const predicate = and(
          eq(workflowRuns.companyId, companyId),
          issue?.originKind === "workflow_node" && issue.originId
            ? eq(workflowRuns.id, issue.originId)
            : eq(workflowRuns.issueId, issueId),
          inArray(workflowRuns.status, [
            "pending",
            "running",
            "paused",
            "waiting_human",
          ]),
        );
        const [run] = await tx
          .select({ id: workflowRuns.id })
          .from(workflowRuns)
          .where(predicate);
        if (!run) return;
        await signalDatabaseWork(tx, WORKFLOW_QUEUE);
        await tx
          .update(workflowRuns)
          .set({ needsReconcile: true })
          .where(eq(workflowRuns.id, run.id));
      });
    },
  };
}
