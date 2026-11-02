import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  instanceSettings,
  companies,
  issues,
  projects,
  workflowRuns,
  workflowNodeAttempts,
  workflowEvaluations,
  workflowTemplateRevisions,
  type Db,
} from "@paperclipai/db";
import {
  createWorkflowRevisionSchema,
  saveWorkflowPolicySchema,
  workflowControlSchema,
  workflowDecisionSchema,
  workflowEvaluationSchema,
  workflowPolicySchema,
  workflowTrialsSchema,
  BUILT_IN_WORKFLOW_TEMPLATES,
  type WorkflowSnapshot,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  assertAuthenticated,
  assertBoard,
  assertCompanyAccess,
  assertInstanceAdmin,
  hasCompanyAccess,
} from "./authz.js";
import { forbidden, notFound, conflict } from "../errors.js";
import {
  issueReadSqlCondition,
  projectReadSqlCondition,
} from "../services/authorization.js";
import { workflowStore } from "../services/workflows/store.js";
import {
  readWorkflowPlatform,
  WORKFLOW_SETTINGS_KEY,
} from "../services/workflows/admission.js";
import type { workflowEngine } from "../services/workflows/engine.js";
import { workflowTransaction } from "../services/workflows/transaction.js";

const platformUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    policy: workflowPolicySchema,
    allowHostCommands: z.boolean(),
  })
  .strict();

export function workflowRoutes(
  db: Db,
  engine: ReturnType<typeof workflowEngine>,
) {
  const router = Router();
  const store = workflowStore(db);

  async function readTask(req: Request) {
    assertAuthenticated(req);
    const [task] = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.id, z.string().guid().parse(req.params.issueId)),
          await issueReadSqlCondition(db, req.actor),
        ),
      );
    if (!task || !hasCompanyAccess(req, task.companyId))
      throw notFound("Task not found");
    assertCompanyAccess(req, task.companyId);
    return task;
  }

  async function readRun(req: Request) {
    const task = await readTask(req);
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.companyId, task.companyId),
          task.originKind === "workflow_node" && task.originId
            ? eq(workflowRuns.id, task.originId)
            : eq(workflowRuns.issueId, task.id),
        ),
      );
    return { task, run: run ?? null };
  }

  router.get("/instance/workflows/defaults", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await readWorkflowPlatform(db));
  });
  router.put(
    "/instance/workflows/defaults",
    validate(platformUpdateSchema),
    async (req, res) => {
      assertInstanceAdmin(req);
      const saved = await workflowTransaction(db, async (context) => {
        const { tx } = context;
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('native-workflows-settings', 0))`,
        );
        const current = await readWorkflowPlatform(tx);
        if (current.version !== req.body.expectedVersion)
          throw conflict(
            "Platform workflow defaults changed; reload before saving",
          );
        const general = {
          version: current.version + 1,
          policy: req.body.policy,
          allowHostCommands: req.body.allowHostCommands,
        };
        await tx
          .insert(instanceSettings)
          .values({ singletonKey: WORKFLOW_SETTINGS_KEY, general })
          .onConflictDoUpdate({
            target: instanceSettings.singletonKey,
            set: { general, updatedAt: new Date() },
          });
        for (const company of await tx
          .select({ id: companies.id })
          .from(companies)) {
          await context.activity({
            companyId: company.id,
            actorType: "user",
            actorId: req.actor.userId ?? "local-board",
            action: "workflow.platform_defaults_updated",
            entityType: "instance_settings",
            entityId: WORKFLOW_SETTINGS_KEY,
            details: {
              version: general.version,
              policy: general.policy,
              allowHostCommands: general.allowHostCommands,
            },
          });
        }
        return general;
      });
      // Instance policy contains no company content. Company actions are audited
      // on each admitted task with the selected platform policy version.
      res.json(saved);
    },
  );
  router.get("/companies/:companyId/workflows", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const [templates, policies, platform, visibleProjects] = await Promise.all([
      store.templates(companyId),
      store.policies(companyId),
      readWorkflowPlatform(db),
      db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.companyId, companyId),
            await projectReadSqlCondition(db, req.actor),
          ),
        ),
    ]);
    const projectIds = new Set(visibleProjects.map((project) => project.id));
    res.json({
      ...templates,
      platform: { version: platform.version, policy: platform.policy },
      policies: policies.filter(
        (policy) => !policy.projectId || projectIds.has(policy.projectId),
      ),
    });
  });
  router.put(
    "/companies/:companyId/workflows/policy",
    validate(saveWorkflowPolicySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      if (req.body.projectId) {
        const [project] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, req.body.projectId),
              eq(projects.companyId, companyId),
              await projectReadSqlCondition(db, req.actor),
            ),
          );
        if (!project) throw notFound("Project not found");
      }
      res.json(
        await store.savePolicy(
          companyId,
          req.body,
          req.actor.userId ?? "local-board",
        ),
      );
    },
  );
  router.post(
    "/companies/:companyId/workflows/revisions",
    validate(createWorkflowRevisionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.status(201).json(
        await store.propose(companyId, req.body, {
          userId:
            req.actor.userId ??
            (req.actor.type === "board" ? "local-board" : null),
          agentId: req.actor.agentId ?? null,
        }),
      );
    },
  );
  router.get(
    "/companies/:companyId/workflows/revisions/:revisionId/baselines",
    async (req, res) => {
      assertBoard(req);
      const { companyId, revisionId } = z
        .object({
          companyId: z.string().guid(),
          revisionId: z.string().guid(),
        })
        .parse(req.params);
      assertCompanyAccess(req, companyId);
      const query = z
        .object({
          q: z.string().trim().max(200).default(""),
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).max(10000).default(0),
        })
        .parse(req.query);
      const [revision] = await db
        .select()
        .from(workflowTemplateRevisions)
        .where(
          and(
            eq(workflowTemplateRevisions.companyId, companyId),
            eq(workflowTemplateRevisions.id, revisionId),
            eq(workflowTemplateRevisions.status, "draft"),
          ),
        );
      if (!revision) throw notFound("Draft revision not found");
      const baseKey = BUILT_IN_WORKFLOW_TEMPLATES.some(
        (item) => item.key === revision.templateKey,
      )
        ? revision.templateKey
        : "standard";
      const search = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const rows = await db
        .select({
          id: workflowRuns.id,
          issueId: issues.id,
          issueIdentifier: issues.identifier,
          issueTitle: issues.title,
          objective: sql<
            WorkflowSnapshot["objective"]
          >`${workflowRuns.snapshot}->'objective'`,
          createdAt: workflowRuns.createdAt,
          finishedAt: workflowRuns.finishedAt,
        })
        .from(workflowRuns)
        .innerJoin(issues, eq(issues.id, workflowRuns.issueId))
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            eq(issues.companyId, companyId),
            eq(workflowRuns.status, "succeeded"),
            revision.basedOnRevisionId
              ? sql`${workflowRuns.snapshot}->>'revisionId' = ${revision.basedOnRevisionId}`
              : and(
                  isNull(sql`${workflowRuns.snapshot}->>'revisionId'`),
                  sql`${workflowRuns.snapshot}->>'templateKey' = ${baseKey}`,
                ),
            query.q
              ? or(
                  ilike(issues.title, search),
                  ilike(issues.identifier, search),
                  ilike(
                    sql`${workflowRuns.snapshot}->'objective'->>'title'`,
                    search,
                  ),
                )
              : undefined,
            await issueReadSqlCondition(db, req.actor),
          ),
        )
        .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
        .limit(query.limit + 1)
        .offset(query.offset);
      res.json({
        items: rows.slice(0, query.limit).map(({ objective, ...row }) => ({
          ...row,
          objectiveTitle: objective.title,
          objectiveFingerprint: createHash("sha256")
            .update(JSON.stringify(objective))
            .digest("hex"),
        })),
        hasMore: rows.length > query.limit,
      });
    },
  );
  router.get(
    "/companies/:companyId/workflows/revisions/:revisionId/evaluations",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const visibleRuns = db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .innerJoin(issues, eq(issues.id, workflowRuns.issueId))
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            await issueReadSqlCondition(db, req.actor),
          ),
        );
      const baseline = alias(workflowRuns, "baseline_workflow");
      const candidate = alias(workflowRuns, "candidate_workflow");
      res.json(
        await db
          .select({
            ...getTableColumns(workflowEvaluations),
            objectiveTitle: sql<string>`${baseline.snapshot}->'objective'->>'title'`,
            baselineIssueId: baseline.issueId,
            candidateIssueId: candidate.issueId,
          })
          .from(workflowEvaluations)
          .innerJoin(
            baseline,
            and(
              eq(baseline.id, workflowEvaluations.baselineRunId),
              eq(baseline.companyId, companyId),
            ),
          )
          .innerJoin(
            candidate,
            and(
              eq(candidate.id, workflowEvaluations.candidateRunId),
              eq(candidate.companyId, companyId),
            ),
          )
          .where(
            and(
              eq(workflowEvaluations.companyId, companyId),
              eq(
                workflowEvaluations.candidateRevisionId,
                req.params.revisionId as string,
              ),
              inArray(workflowEvaluations.baselineRunId, visibleRuns),
              inArray(workflowEvaluations.candidateRunId, visibleRuns),
            ),
          ),
      );
    },
  );
  router.post(
    "/companies/:companyId/workflows/revisions/:revisionId/evaluations",
    validate(workflowEvaluationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const visible = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .innerJoin(issues, eq(issues.id, workflowRuns.issueId))
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            inArray(workflowRuns.id, [
              req.body.baselineRunId,
              req.body.candidateRunId,
            ]),
            await issueReadSqlCondition(db, req.actor),
          ),
        );
      if (visible.length !== 2) throw notFound("Evaluation run not found");
      res
        .status(201)
        .json(
          await store.evaluate(
            companyId,
            req.params.revisionId as string,
            req.body,
            req.actor.userId ?? "local-board",
          ),
        );
    },
  );
  router.post(
    "/companies/:companyId/workflows/revisions/:revisionId/publish",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      res.json(
        await store.publish(
          companyId,
          req.params.revisionId as string,
          req.actor.userId ?? "local-board",
        ),
      );
    },
  );
  router.post(
    "/companies/:companyId/workflows/revisions/:revisionId/trials",
    validate(workflowTrialsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const visible = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .innerJoin(issues, eq(issues.id, workflowRuns.issueId))
        .where(
          and(
            eq(workflowRuns.companyId, companyId),
            inArray(workflowRuns.id, req.body.baselineRunIds),
            await issueReadSqlCondition(db, req.actor),
          ),
        );
      if (visible.length !== req.body.baselineRunIds.length)
        throw notFound("Baseline run not found");
      res
        .status(201)
        .json(
          await store.startTrials(
            companyId,
            req.params.revisionId as string,
            req.body.baselineRunIds,
            req.actor.userId ?? "local-board",
          ),
        );
    },
  );
  router.get("/issues/:issueId/workflow", async (req, res) => {
    const { task, run } = await readRun(req);
    if (!run) {
      res.json(null);
      return;
    }
    const node =
      task.id === run.issueId
        ? null
        : run.snapshot.definition.nodes.find(
            (definition) => run.nodes[definition.id].issueId === task.id,
          );
    if (task.id !== run.issueId && !node)
      throw notFound("Workflow node not found");
    const attempts = await db
      .select({
        id: workflowNodeAttempts.id,
        nodeId: workflowNodeAttempts.nodeId,
        attempt: workflowNodeAttempts.attempt,
        issueId: workflowNodeAttempts.issueId,
        status: workflowNodeAttempts.status,
        evidence: workflowNodeAttempts.evidence,
        decisionAgentId: workflowNodeAttempts.decisionAgentId,
        decisionUserId: workflowNodeAttempts.decisionUserId,
        createdAt: workflowNodeAttempts.createdAt,
        finishedAt: workflowNodeAttempts.finishedAt,
      })
      .from(workflowNodeAttempts)
      .where(
        and(
          eq(workflowNodeAttempts.companyId, task.companyId),
          eq(workflowNodeAttempts.runId, run.id),
          node ? eq(workflowNodeAttempts.nodeId, node.id) : undefined,
        ),
      )
      .orderBy(asc(workflowNodeAttempts.createdAt));
    res.json({
      ...publicRun(run),
      isRoot: task.id === run.issueId,
      snapshot: node
        ? {
            ...run.snapshot,
            definition: { ...run.snapshot.definition, nodes: [node] },
          }
        : run.snapshot,
      nodes: node ? { [node.id]: run.nodes[node.id] } : run.nodes,
      attempts,
    });
  });
  router.post(
    "/issues/:issueId/workflow/control",
    validate(workflowControlSchema),
    async (req, res) => {
      assertBoard(req);
      const { task, run } = await readRun(req);
      if (!run || task.id !== run.issueId)
        throw notFound("Workflow root not found");
      res.json(
        publicRun(
          await engine.control(
            task.companyId,
            run.issueId,
            req.body,
            req.actor.userId ?? "local-board",
          ),
        ),
      );
    },
  );
  router.post(
    "/issues/:issueId/workflow/decisions",
    validate(workflowDecisionSchema),
    async (req, res) => {
      const { task, run } = await readRun(req);
      if (!run) throw notFound("Workflow not found");
      if (
        task.id !== run.issueId &&
        run.nodes[req.body.nodeId]?.issueId !== task.id
      )
        throw forbidden(
          "A node grant permits decisions only on that exact node",
        );
      const saved = await engine.decide(task.companyId, run.issueId, req.body, {
        userId:
          req.actor.userId ??
          (req.actor.type === "board" ? "local-board" : null),
        agentId: req.actor.agentId ?? null,
        runId: req.actor.runId ?? null,
      });
      res.json({ id: saved.id, version: saved.version, status: saved.status });
    },
  );
  return router;
}

function publicRun(run: typeof workflowRuns.$inferSelect) {
  return {
    id: run.id,
    companyId: run.companyId,
    issueId: run.issueId,
    status: run.status,
    version: run.version,
    snapshot: run.snapshot,
    nodes: run.nodes,
    stopReason: run.stopReason,
    deadlineAt: run.deadlineAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
