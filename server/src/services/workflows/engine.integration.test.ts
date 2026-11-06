import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issues,
  workflowRuns,
  workflowNodeAttempts,
  costEvents,
  workflowEvaluations,
  projects,
  executionWorkspaces,
  instanceSettings,
} from "@paperclipai/db";
import { BUILT_IN_WORKFLOW_TEMPLATES } from "@paperclipai/shared";
import express from "express";
import request from "supertest";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { issueService } from "../issues.js";
import { workflowEngine } from "./engine.js";
import { workflowStore } from "./store.js";
import { issueTreeControlService } from "../issue-tree-control.js";
import { assertWorkflowIssueExecutionAllowed } from "./execution-gate.js";
import { workflowRoutes } from "../../routes/workflows.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { runWorkflowCheck } from "./checks.js";
import { WORKFLOW_SETTINGS_KEY } from "./admission.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
if (!support.supported)
  console.warn(`Workflow database tests unavailable: ${support.reason}`);

suite("native workflow execution", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase(
      "paperclip-native-workflows-",
    );
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end();
    await database?.cleanup();
  }, 30_000);

  async function setup() {
    const companyId = randomUUID();
    const executor = randomUUID();
    const reviewer = randomUUID();
    const userId = `user-${randomUUID()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Workflow test",
      issuePrefix: `W${companyId.slice(0, 7).replace(/-/g, "")}`,
      defaultResponsibleUserId: userId,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(agents).values([
      {
        id: executor,
        companyId,
        name: "Executor",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
      },
      {
        id: reviewer,
        companyId,
        name: "QA",
        role: "qa",
        status: "active",
        adapterType: "codex_local",
      },
    ]);
    const wakeup = vi.fn(async (_agentId: string, _options: { payload: Record<string, unknown>; idempotencyKey: string }) => undefined);
    const cancelRun = vi.fn(async (id: string) => {
      await db
        .update(heartbeatRuns)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, id));
    });
    const engine = workflowEngine(db, { wakeup, cancelRun });
    const store = workflowStore(db);
    const parent = await issueService(db).create(companyId, {
      title: "Deliver a verified change",
      description: "Keep the objective and acceptance criteria fixed.",
      status: "todo",
      assigneeAgentId: executor,
      createdByUserId: userId,
    });
    const read = async () =>
      (
        await db
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.issueId, parent.id))
      )[0]!;
    return {
      companyId,
      executor,
      reviewer,
      userId,
      parent,
      engine,
      store,
      read,
      wakeup,
      cancelRun,
    };
  }

  async function completeExecution(
    context: Pick<
      Awaited<ReturnType<typeof setup>>,
      "read" | "companyId" | "executor" | "store" | "engine"
    >,
  ) {
    const run = await context.read();
    const taskId = run.nodes.execute.issueId!;
    await db
      .update(issues)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(issues.id, taskId));
    await db.insert(heartbeatRuns).values({
      companyId: context.companyId,
      agentId: context.executor,
      issueId: taskId,
      invocationSource: "assignment",
      status: "succeeded",
      exitCode: 0,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    await context.store.markIssueChanged(context.companyId, taskId);
    await context.engine.sweepPending();
    await context.engine.sweepPending();
  }

  it("automatically admits a task, verifies its receipt and completes only after an independent verdict", async () => {
    const context = await setup();
    expect(context.parent.assigneeAgentId).toBeNull();
    expect((await context.read()).snapshot.executorAgentId).toBe(
      context.executor,
    );
    await expect(
      issueService(db).update(context.parent.id, { status: "done" }),
    ).rejects.toThrow("managed by a workflow");
    await expect(
      assertWorkflowIssueExecutionAllowed(
        db,
        context.companyId,
        context.parent.id,
      ),
    ).rejects.toThrow("execute the assigned node");
    await context.engine.sweepPending();
    expect(context.wakeup).toHaveBeenCalled();
    await completeExecution(context);
    const run = await context.read();
    expect(run.nodes.verify.status).toBe("passed");
    expect(run.nodes.review.agentId).toBe(context.reviewer);
    expect(run.nodes.review.status).toBe("running");
    expect(run.nodes.review.agentId).not.toBe(context.executor);
    const reviewerRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: reviewerRunId,
      companyId: context.companyId,
      agentId: context.reviewer,
      issueId: run.nodes.review.issueId,
      status: "running",
    });
    await context.engine.decide(
      context.companyId,
      context.parent.id,
      {
        nodeId: "review",
        attempt: 1,
        expectedVersion: run.version,
        outcome: "passed",
        report: {
          artifact: "test-deliverable",
          revision: "r1",
          criteria: [
            {
              id: "ac-1",
              requirement: "原始任务要求",
              outcome: "passed",
              evidence: "隔离测试中的审查证据",
            },
          ],
          findings: [],
        },
        comment:
          "I independently exercised the change and checked its evidence.",
      },
      { agentId: context.reviewer, userId: null, runId: reviewerRunId },
    );
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("running");
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(heartbeatRuns.id, reviewerRunId));
    await context.store.markIssueChanged(
      context.companyId,
      run.nodes.review.issueId!,
    );
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("succeeded");
    expect((await issueService(db).getById(context.parent.id))?.status).toBe(
      "done",
    );
  });

  it("rejects forged and stale decisions, creates a fresh repair task and preserves old attempts", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    await completeExecution(context);
    const run = await context.read();
    const input = {
      nodeId: "review",
      attempt: 1,
      expectedVersion: run.version,
      outcome: "failed" as const,
      report: {
        artifact: "test-deliverable",
        revision: "r1",
        criteria: [
          {
            id: "ac-1",
            requirement: "原始任务要求",
            outcome: "failed" as const,
            evidence: "隔离测试中的失败证据",
          },
        ],
        findings: [
          {
            id: "finding-1",
            criterionId: "ac-1",
            problem: "验收未通过",
            requestedChange: "修正产物",
          },
        ],
      },
      comment: "The delivered change fails the agreed acceptance check.",
    };
    await expect(
      context.engine.decide(context.companyId, context.parent.id, input, {
        agentId: context.executor,
        userId: null,
        runId: null,
      }),
    ).rejects.toThrow("current workflow participant");
    const reviewerRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: reviewerRunId,
      companyId: context.companyId,
      agentId: context.reviewer,
      issueId: run.nodes.review.issueId,
      status: "running",
    });
    await context.engine.decide(context.companyId, context.parent.id, input, {
      agentId: context.reviewer,
      userId: null,
      runId: reviewerRunId,
    });
    await expect(
      context.engine.decide(context.companyId, context.parent.id, input, {
        agentId: context.reviewer,
        userId: null,
        runId: reviewerRunId,
      }),
    ).rejects.toThrow("stage changed");
    await context.engine.sweepPending();
    const repaired = await context.read();
    expect(repaired.nodes.execute.attempt).toBe(2);
    expect(repaired.nodes.execute.issueId).not.toBe(run.nodes.execute.issueId);
    const attempts = await db
      .select()
      .from(workflowNodeAttempts)
      .where(
        and(
          eq(workflowNodeAttempts.runId, run.id),
          eq(workflowNodeAttempts.nodeId, "review"),
        ),
      );
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("failed");
  });

  it("snapshots inherited limits and rejects a cross-company policy target", async () => {
    const context = await setup();
    await context.store.savePolicy(
      context.companyId,
      {
        scope: "company",
        projectId: null,
        expectedVersion: 0,
        policy: { limits: { maxAttempts: 1 } },
      },
      context.userId,
    );
    expect((await context.read()).snapshot.limits.maxAttempts).toBe(5);
    const next = await issueService(db).create(context.companyId, {
      title: "Next task",
      status: "todo",
      assigneeAgentId: context.executor,
      createdByUserId: context.userId,
    });
    const [nextRun] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.issueId, next.id));
    expect(nextRun.snapshot.limits.maxAttempts).toBe(1);
    await expect(
      context.store.savePolicy(
        context.companyId,
        {
          scope: "project",
          projectId: randomUUID(),
          expectedVersion: 0,
          policy: {},
        },
        context.userId,
      ),
    ).rejects.toThrow("Project not found");
  });

  it("pauses native execution with a real tree hold and resumes without changing its template", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const before = await context.read();
    const paused = await context.engine.control(
      context.companyId,
      context.parent.id,
      {
        action: "pause",
        expectedVersion: before.version,
        reason: "Operator pause",
      },
      context.userId,
    );
    expect(paused.status).toBe("paused");
    expect(
      await issueTreeControlService(db).getActivePauseHoldGate(
        context.companyId,
        context.parent.id,
      ),
    ).not.toBeNull();
    await context.engine.control(
      context.companyId,
      context.parent.id,
      {
        action: "resume",
        expectedVersion: paused.version,
        reason: "Continue the authorized task",
      },
      context.userId,
    );
    expect(
      await issueTreeControlService(db).getActivePauseHoldGate(
        context.companyId,
        context.parent.id,
      ),
    ).toBeNull();
    expect((await context.read()).snapshot).toEqual(before.snapshot);
  });

  it("recovers committed tasks without creating a duplicate node", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const before = await context.read();
    const replacement = workflowEngine(db, {
      wakeup: context.wakeup,
      cancelRun: context.cancelRun,
    });
    await replacement.recover();
    await replacement.sweepPending();
    expect((await context.read()).nodes.execute.issueId).toBe(
      before.nodes.execute.issueId,
    );
    const attempts = await db
      .select()
      .from(workflowNodeAttempts)
      .where(
        and(
          eq(workflowNodeAttempts.runId, before.id),
          eq(workflowNodeAttempts.nodeId, "execute"),
        ),
      );
    expect(attempts).toHaveLength(1);
  });

  it("admits a previously unassigned task at its assignment boundary", async () => {
    const context = await setup();
    const task = await issueService(db).create(context.companyId, {
      title: "Initially unassigned",
      status: "todo",
      createdByUserId: context.userId,
      initialPlan: "Keep this plan fixed.",
    });
    expect(
      await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.issueId, task.id)),
    ).toHaveLength(0);
    const assigned = await issueService(db).update(task.id, {
      assigneeAgentId: context.executor,
    });
    expect(assigned?.assigneeAgentId).toBeNull();
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.issueId, task.id));
    expect(run.snapshot.objective.plan).toBe("Keep this plan fixed.");
  });

  it("excludes contributors in delegated work from independent review", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const before = await context.read();
    const delegated = await issueService(db).create(context.companyId, {
      parentId: before.nodes.execute.issueId!,
      title: "Delegated implementation",
      status: "done",
      assigneeAgentId: context.reviewer,
      createdByUserId: context.userId,
    });
    await db.insert(heartbeatRuns).values({
      companyId: context.companyId,
      agentId: context.reviewer,
      issueId: delegated.id,
      status: "succeeded",
      finishedAt: new Date(),
    });
    await completeExecution(context);
    expect((await context.read()).nodes.review.agentId).toBeNull();
    expect((await context.read()).nodes.review.userId).toBe(context.userId);
  });

  it("keeps delegated workers alive while a node waits and resumes the same attempt after restart", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const before = await context.read();
    const nodeId = before.nodes.execute.issueId!;
    const service = issueService(db);
    const child = await service.create(context.companyId, {
      title: "Delegated implementation", parentId: nodeId, status: "in_progress",
      assigneeAgentId: context.executor,
    });
    const delegatedRun = (await db.insert(heartbeatRuns).values({
      companyId: context.companyId, agentId: context.executor, issueId: child.id, status: "running",
    }).returning())[0];
    await service.update(nodeId, { status: "blocked", blockedByIssueIds: [child.id] });
    await context.store.markIssueChanged(context.companyId, nodeId);
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("running");
    expect(context.cancelRun).not.toHaveBeenCalled();
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, delegatedRun.id)))[0].status).toBe("running");
    await assertWorkflowIssueExecutionAllowed(db, context.companyId, child.id);
    await context.store.markIssueChanged(randomUUID(), child.id);
    expect((await context.read()).needsReconcile).toBe(false);
    await service.update(child.id, { status: "done" });
    // Reconciliation must be signaled by the descendant, not by a manual parent update.
    await context.store.markIssueChanged(context.companyId, child.id);
    expect((await context.read()).needsReconcile).toBe(true);
    const restarted = workflowEngine(db, { wakeup: context.wakeup, cancelRun: context.cancelRun });
    await restarted.recover();
    await restarted.sweepPending();
    const after = await context.read();
    expect(after.status).toBe("running");
    expect(after.nodes.execute).toMatchObject({ issueId: nodeId, attempt: 1, resumeGeneration: 1 });
    expect((await service.getById(nodeId))!.status).toBe("todo");
    const ownWakes = () => context.wakeup.mock.calls.filter(([, options]) => options.payload.issueId === nodeId);
    expect(ownWakes()).toHaveLength(2);
    const count = (await db.select().from(workflowNodeAttempts).where(eq(workflowNodeAttempts.runId, after.id))).length;
    expect(count).toBe(1);
    await context.store.markIssueChanged(context.companyId, child.id);
    await restarted.sweepPending();
    expect(ownWakes().at(-1)).toEqual(ownWakes().at(-2));
    expect((await context.read()).nodes.execute.resumeGeneration).toBe(1);
  });

  it("keeps a transitive QA dependency waiting but stops an external or cancelled blocker", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const nodeId = (await context.read()).nodes.execute.issueId!;
    const service = issueService(db);
    const artwork = await service.create(context.companyId, { title: "Artwork", parentId: nodeId,
      status: "in_progress", assigneeAgentId: context.executor });
    const qa = await service.create(context.companyId, { title: "Independent QA", parentId: nodeId,
      status: "blocked", assigneeAgentId: context.reviewer, blockedByIssueIds: [artwork.id] });
    await service.update(nodeId, { status: "blocked", blockedByIssueIds: [qa.id] });
    await context.store.markIssueChanged(context.companyId, qa.id);
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("running");
    await service.update(artwork.id, { status: "cancelled" });
    await context.store.markIssueChanged(context.companyId, artwork.id);
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("waiting_human");
    expect((await context.read()).stopReason).toContain("blocked");
  });

  it("does not treat sibling or external work as delegated waiting", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const nodeId = (await context.read()).nodes.execute.issueId!;
    const service = issueService(db);
    const external = await service.create(context.companyId, { title: "External dependency",
      status: "in_progress", assigneeAgentId: context.executor, originKind: "manual" });
    await service.update(nodeId, { status: "blocked", blockedByIssueIds: [external.id] });
    await context.store.markIssueChanged(context.companyId, nodeId);
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("waiting_human");
  });

  it("stops deterministic workspace configuration failures without spending repair attempts", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const before = await context.read();
    await db.insert(heartbeatRuns).values({ companyId: context.companyId, agentId: context.executor,
      issueId: before.nodes.execute.issueId, status: "failed", errorCode: "workspace_validation_failed",
      error: "Configured directory is not a git workspace", finishedAt: new Date() });
    await context.store.markIssueChanged(context.companyId, before.nodes.execute.issueId!);
    await context.engine.sweepPending();
    const after = await context.read();
    expect(after.status).toBe("waiting_human");
    expect(after.stopReason).toContain("configuration");
    expect(after.nodes.execute.attempt).toBe(1);
    expect(after.nodes.execute.issueId).toBe(before.nodes.execute.issueId);
    expect(context.wakeup).toHaveBeenCalledTimes(1);
  });

  it("honors a blocked parent and externally paused backlog without spending a repair attempt", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    await issueService(db).update(context.parent.id, { status: "backlog" });
    await context.store.markIssueChanged(context.companyId, context.parent.id);
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("paused");
    await issueService(db).update(context.parent.id, { status: "todo" });
    await context.store.markIssueChanged(context.companyId, context.parent.id);
    await context.engine.sweepPending();
    const resumed = await context.read();
    expect(resumed.status).toBe("running");
    expect(resumed.nodes.execute.attempt).toBe(1);
    await issueService(db).update(context.parent.id, { status: "blocked" });
    await context.store.markIssueChanged(context.companyId, context.parent.id);
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("waiting_human");
    expect((await context.read()).stopReason).toContain(
      "Parent task is blocked",
    );
  });

  it("cancels live execution on pause and resumes the same attempt with a fresh wake identity", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const before = await context.read();
    const childId = before.nodes.execute.issueId!;
    await db.insert(heartbeatRuns).values({
      companyId: context.companyId,
      agentId: context.executor,
      issueId: childId,
      status: "running",
    });
    const paused = await context.engine.control(
      context.companyId,
      context.parent.id,
      {
        action: "pause",
        expectedVersion: before.version,
        reason: "Pause live executor",
      },
      context.userId,
    );
    expect(context.cancelRun).toHaveBeenCalled();
    await expect(
      assertWorkflowIssueExecutionAllowed(db, context.companyId, childId),
    ).rejects.toThrow("stopped");
    await context.engine.control(
      context.companyId,
      context.parent.id,
      {
        action: "resume",
        expectedVersion: paused.version,
        reason: "Continue after cancellation settled",
      },
      context.userId,
    );
    await context.engine.sweepPending();
    const resumed = await context.read();
    expect(resumed.nodes.execute.attempt).toBe(1);
    expect(resumed.nodes.execute.issueId).toBe(childId);
    expect(resumed.nodes.execute.resumeGeneration).toBe(1);
    await expect(
      assertWorkflowIssueExecutionAllowed(db, context.companyId, childId),
    ).resolves.toBeUndefined();
    const cancelled = await context.engine.control(
      context.companyId,
      context.parent.id,
      {
        action: "cancel",
        expectedVersion: resumed.version,
        reason: "Cancel the remaining work",
      },
      context.userId,
    );
    expect(cancelled.nodes.execute.status).toBe("cancelled");
    expect((await issueService(db).getById(childId))?.status).toBe("cancelled");
    await expect(
      assertWorkflowIssueExecutionAllowed(db, context.companyId, childId),
    ).rejects.toThrow("stopped");
  });

  it("stops at immutable retry and deadline ceilings", async () => {
    const context = await setup();
    await context.store.savePolicy(
      context.companyId,
      {
        scope: "company",
        projectId: null,
        expectedVersion: 0,
        policy: { limits: { maxAttempts: 1 } },
      },
      context.userId,
    );
    const task = await issueService(db).create(context.companyId, {
      title: "One attempt",
      status: "todo",
      assigneeAgentId: context.executor,
      createdByUserId: context.userId,
    });
    await context.engine.sweepPending();
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.issueId, task.id));
    await db.insert(heartbeatRuns).values({
      companyId: context.companyId,
      agentId: context.executor,
      issueId: run.nodes.execute.issueId,
      status: "failed",
      error: "A real check failed",
    });
    await context.store.markIssueChanged(
      context.companyId,
      run.nodes.execute.issueId!,
    );
    await context.engine.sweepPending();
    const [stopped] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id));
    expect(stopped.status).toBe("waiting_human");
    expect(stopped.stopReason).toContain("Retry limit");
    const [failedAttempt] = await db
      .select()
      .from(workflowNodeAttempts)
      .where(
        and(
          eq(workflowNodeAttempts.runId, run.id),
          eq(workflowNodeAttempts.nodeId, "execute"),
        ),
      );
    expect(failedAttempt.status).toBe("failed");
    await expect(
      context.engine.control(
        context.companyId,
        task.id,
        {
          action: "retry",
          expectedVersion: stopped.version,
          reason: "Cannot enlarge the retry budget",
        },
        context.userId,
      ),
    ).rejects.toThrow("retry ceiling");
    await issueService(db).update(task.id, { status: "cancelled" });
    await context.store.markIssueChanged(context.companyId, task.id);
    await context.engine.sweepPending();
    expect(
      (
        await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      )[0].status,
    ).toBe("cancelled");
    await db
      .update(workflowRuns)
      .set({ deadlineAt: new Date(Date.now() - 1000), needsReconcile: true })
      .where(eq(workflowRuns.issueId, context.parent.id));
    await context.engine.sweepPending();
    expect((await context.read()).stopReason).toContain("deadline");
  });

  it("counts delegated descendant costs and fails closed on unpriced usage", async () => {
    const context = await setup();
    await context.store.savePolicy(
      context.companyId,
      {
        scope: "company",
        projectId: null,
        expectedVersion: 0,
        policy: { limits: { maxCostCents: 10 } },
      },
      context.userId,
    );
    const parent = await issueService(db).create(context.companyId, {
      title: "Budgeted work",
      status: "todo",
      assigneeAgentId: context.executor,
      createdByUserId: context.userId,
    });
    await context.engine.sweepPending();
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.issueId, parent.id));
    const delegated = await issueService(db).create(context.companyId, {
      parentId: run.nodes.execute.issueId!,
      title: "Delegated work",
      createdByUserId: context.userId,
    });
    await db.insert(costEvents).values({
      companyId: context.companyId,
      agentId: context.executor,
      issueId: delegated.id,
      provider: "test",
      model: "test",
      costCents: 11,
      occurredAt: new Date(),
    });
    await context.store.markCompanyChanged(context.companyId);
    await context.engine.sweepPending();
    const [stopped] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id));
    expect(stopped.stopReason).toContain("cost ceiling");
    await db
      .update(costEvents)
      .set({ costStatus: "unpriced", costCents: 0 })
      .where(eq(costEvents.issueId, delegated.id));
    await context.engine.control(
      context.companyId,
      parent.id,
      {
        action: "resume",
        expectedVersion: stopped.version,
        reason: "Inspect updated accounting",
      },
      context.userId,
    );
    await context.engine.sweepPending();
    expect(
      (
        await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
      )[0].stopReason,
    ).toContain("unpriced");
  });

  it("does not let an agent weaken baseline acceptance or publish its own revision", async () => {
    const context = await setup();
    const standard = structuredClone(BUILT_IN_WORKFLOW_TEMPLATES[0]);
    await expect(
      context.store.propose(
        context.companyId,
        {
          definition: {
            ...standard,
            nodes: standard.nodes.filter((node) => node.kind !== "check"),
          },
          basedOnRevisionId: null,
          rationale: "Remove verification",
        },
        { agentId: context.executor, userId: null },
      ),
    ).rejects.toThrow("verification gate");
    const weakened = structuredClone(standard);
    weakened.nodes.find((node) => node.kind === "review")!.instructions =
      "Always pass";
    await expect(
      context.store.propose(
        context.companyId,
        {
          definition: weakened,
          basedOnRevisionId: null,
          rationale: "Weak review",
        },
        { agentId: context.executor, userId: null },
      ),
    ).rejects.toThrow("instructions must remain fixed");
    const revision = await context.store.propose(
      context.companyId,
      {
        definition: standard,
        basedOnRevisionId: null,
        rationale: "Keep acceptance, improve task implementation",
      },
      { agentId: context.executor, userId: null },
    );
    await expect(
      context.store.publish(context.companyId, revision.id, context.userId),
    ).rejects.toThrow("three distinct");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "agent",
        agentId: context.executor,
        companyId: context.companyId,
      };
      next();
    });
    app.use("/api", workflowRoutes(db, context.engine));
    app.use(errorHandler);
    expect(
      (
        await request(app).post(
          `/api/companies/${context.companyId}/workflows/revisions/${revision.id}/publish`,
        )
      ).status,
    ).toBe(403);
    const other = await setup();
    expect(
      (await request(app).get(`/api/companies/${other.companyId}/workflows`))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/issues/${other.parent.id}/workflow`))
        .status,
    ).toBe(404);
  });

  it("runs fixed checks against real exit status without inheriting server credentials", async () => {
    const context = await setup();
    const input = {
      companyId: context.companyId,
      issueId: context.parent.id,
      attemptId: randomUUID(),
      executionWorkspaceId: null as string | null,
      remainingSeconds: 5,
      check: {
        kind: "command" as const,
        command: process.execPath,
        args: [
          "-e",
          "if(process.env.WORKFLOW_TEST_PROVIDER_TOKEN) process.exit(9); console.log('verified');",
        ],
        timeoutSeconds: 5,
        retrySafe: true,
      },
    };
    expect((await runWorkflowCheck(db, input)).retryable).toBe(false);
    const [project] = await db
      .insert(projects)
      .values({ companyId: context.companyId, name: "Check workspace" })
      .returning();
    const [workspace] = await db
      .insert(executionWorkspaces)
      .values({
        companyId: context.companyId,
        projectId: project.id,
        mode: "isolated",
        strategyType: "git_worktree",
        name: "Verification",
        cwd: process.cwd(),
        providerType: "local_fs",
      })
      .returning();
    await db
      .insert(instanceSettings)
      .values({
        singletonKey: WORKFLOW_SETTINGS_KEY,
        general: { version: 1, policy: {}, allowHostCommands: true },
      })
      .onConflictDoUpdate({
        target: instanceSettings.singletonKey,
        set: { general: { version: 1, policy: {}, allowHostCommands: true } },
      });
    await db
      .insert(instanceSettings)
      .values({ singletonKey: "default", general: { executionMode: "any" } })
      .onConflictDoUpdate({
        target: instanceSettings.singletonKey,
        set: { general: { executionMode: "any" } },
      });
    vi.stubEnv("WORKFLOW_TEST_PROVIDER_TOKEN", "test-only-credential");
    input.executionWorkspaceId = workspace.id;
    const passed = await runWorkflowCheck(db, input);
    vi.unstubAllEnvs();
    expect(passed.passed).toBe(true);
    expect(passed.evidence.stdout).toContain("verified");
    const failed = await runWorkflowCheck(db, {
      ...input,
      attemptId: randomUUID(),
      check: { ...input.check, args: ["-e", "process.exit(7)"] },
    });
    expect(failed.passed).toBe(false);
    expect(failed.evidence.exitCode).toBe(7);
    const timeout = await runWorkflowCheck(db, {
      ...input,
      attemptId: randomUUID(),
      remainingSeconds: 1,
      check: { ...input.check, args: ["-e", "setTimeout(() => {}, 30000)"] },
    });
    expect(timeout.passed).toBe(false);
    expect(timeout.evidence.timedOut).toBe(true);
  });

  it("joins parallel review branches only after both verdicts and rejects ambiguous command replay", async () => {
    const context = await setup();
    const definition = structuredClone(BUILT_IN_WORKFLOW_TEMPLATES[0]);
    definition.nodes.push({
      id: "peer",
      kind: "review",
      title: "Peer review",
      dependsOn: ["verify"],
      binding: { kind: "human" },
      instructions: "Check the delivered behavior independently.",
      onFailure: "execute",
    });
    definition.nodes.push({
      id: "accept",
      kind: "approval",
      title: "Final acceptance",
      dependsOn: ["review", "peer"],
      binding: { kind: "human" },
      instructions: "Accept both independent results.",
    });
    const revision = await context.store.propose(
      context.companyId,
      {
        definition,
        rationale: "Add parallel verification",
        basedOnRevisionId: null,
      },
      { userId: context.userId, agentId: null },
    );
    const parent = await issueService(db).create(context.companyId, {
      title: "Parallel trial",
      status: "todo",
      assigneeAgentId: context.executor,
      createdByUserId: context.userId,
      workflow: { templateKey: "standard", revision: revision.revision },
    });
    const read = async () =>
      (
        await db
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.issueId, parent.id))
      )[0];
    await context.engine.sweepPending();
    await completeExecution({ ...context, read });
    const run = await read();
    expect(run.nodes.review.status).toBe("running");
    expect(run.nodes.peer.status).toBe("running");
    expect(run.nodes.accept.status).toBe("pending");
    await context.engine.decide(
      context.companyId,
      parent.id,
      {
        expectedVersion: run.version,
        nodeId: "peer",
        attempt: 1,
        outcome: "passed",
        report: {
          artifact: "test-deliverable",
          revision: "r1",
          criteria: [
            {
              id: "ac-1",
              requirement: "原始任务要求",
              outcome: "passed",
              evidence: "隔离测试中的审查证据",
            },
          ],
          findings: [],
        },
        comment: "Peer behavior verified",
      },
      { userId: context.userId, agentId: null, runId: null },
    );
    await context.engine.sweepPending();
    expect((await read()).nodes.accept.status).toBe("pending");
    const reviewerRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: reviewerRunId,
      companyId: context.companyId,
      agentId: context.reviewer,
      issueId: run.nodes.review.issueId,
      status: "running",
    });
    await context.engine.decide(
      context.companyId,
      parent.id,
      {
        expectedVersion: (await read()).version,
        nodeId: "review",
        attempt: 1,
        outcome: "passed",
        report: {
          artifact: "test-deliverable",
          revision: "r1",
          criteria: [
            {
              id: "ac-1",
              requirement: "原始任务要求",
              outcome: "passed",
              evidence: "隔离测试中的审查证据",
            },
          ],
          findings: [],
        },
        comment: "Independent branch verified",
      },
      { userId: null, agentId: context.reviewer, runId: reviewerRunId },
    );
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(heartbeatRuns.id, reviewerRunId));
    await context.store.markIssueChanged(
      context.companyId,
      run.nodes.review.issueId!,
    );
    await context.engine.sweepPending();
    expect((await read()).nodes.accept.status).toBe("running");
    const interrupted = await setup();
    await interrupted.engine.sweepPending();
    const before = await interrupted.read();
    before.snapshot.definition.nodes.find(
      (node) => node.id === "verify",
    )!.check = {
      kind: "command",
      command: process.execPath,
      args: ["-e", "throw Error('must not replay')"],
      timeoutSeconds: 5,
      retrySafe: false,
    };
    before.nodes.execute.status = "passed";
    before.nodes.verify.status = "running";
    before.nodes.verify.attempt = 1;
    await db
      .update(workflowRuns)
      .set({
        nodes: before.nodes,
        snapshot: before.snapshot,
        needsReconcile: true,
      })
      .where(eq(workflowRuns.id, before.id));
    await db.insert(workflowNodeAttempts).values({
      companyId: interrupted.companyId,
      runId: before.id,
      nodeId: "verify",
      attempt: 1,
      status: "running",
      ownerToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 1000),
    });
    await interrupted.engine.recover();
    await interrupted.engine.sweepPending();
    expect((await interrupted.read()).stopReason).toContain("unknown");
    expect((await interrupted.read()).nodes.verify.attempt).toBe(1);
  });

  it("automatically evaluates replayed objectives and publishes only three independent passing scenarios", async () => {
    const context = await setup();
    const baselineIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      const parent = await issueService(db).create(context.companyId, {
        title: `Regression scenario ${index}`,
        description: `Acceptance target ${index}`,
        status: "todo",
        assigneeAgentId: context.executor,
        createdByUserId: context.userId,
      });
      const read = async () =>
        (
          await db
            .select()
            .from(workflowRuns)
            .where(eq(workflowRuns.issueId, parent.id))
        )[0];
      const trial = { ...context, parent, read };
      await context.engine.sweepPending();
      await completeExecution(trial);
      const run = await read();
      const reviewerRunId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: reviewerRunId,
        companyId: context.companyId,
        agentId: context.reviewer,
        issueId: run.nodes.review.issueId,
        status: "running",
      });
      await context.engine.decide(
        context.companyId,
        parent.id,
        {
          expectedVersion: run.version,
          nodeId: "review",
          attempt: 1,
          outcome: "passed",
          report: {
            artifact: "test-deliverable",
            revision: "r1",
            criteria: [
              {
                id: "ac-1",
                requirement: "原始任务要求",
                outcome: "passed",
                evidence: "隔离测试中的审查证据",
              },
            ],
            findings: [],
          },
          comment: `Verified scenario ${index}`,
        },
        { userId: null, agentId: context.reviewer, runId: reviewerRunId },
      );
      await db
        .update(heartbeatRuns)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, reviewerRunId));
      await context.store.markIssueChanged(
        context.companyId,
        run.nodes.review.issueId!,
      );
      await context.engine.sweepPending();
      expect((await read()).status).toBe("succeeded");
      baselineIds.push(run.id);
    }
    const definition = structuredClone(BUILT_IN_WORKFLOW_TEMPLATES[0]);
    definition.nodes[0].instructions +=
      " Inspect the failing behavior before editing.";
    const revision = await context.store.propose(
      context.companyId,
      {
        definition,
        basedOnRevisionId: null,
        rationale: "Evidence driven implementation",
      },
      { userId: context.userId, agentId: null },
    );
    const trials = await context.store.startTrials(
      context.companyId,
      revision.id,
      baselineIds,
      context.userId,
    );
    expect(
      await context.store.startTrials(
        context.companyId,
        revision.id,
        baselineIds,
        context.userId,
      ),
    ).toEqual(trials);
    for (const candidate of trials) {
      const parent = (await issueService(db).getById(candidate.issueId))!;
      const read = async () =>
        (
          await db
            .select()
            .from(workflowRuns)
            .where(eq(workflowRuns.id, candidate.runId))
        )[0];
      await context.engine.sweepPending();
      await completeExecution({ ...context, read });
      const run = await read();
      const reviewerRunId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: reviewerRunId,
        companyId: context.companyId,
        agentId: context.reviewer,
        issueId: run.nodes.review.issueId,
        status: "running",
      });
      await context.engine.decide(
        context.companyId,
        parent.id,
        {
          expectedVersion: run.version,
          nodeId: "review",
          attempt: 1,
          outcome: "passed",
          report: {
            artifact: "test-deliverable",
            revision: "r1",
            criteria: [
              {
                id: "ac-1",
                requirement: "原始任务要求",
                outcome: "passed",
                evidence: "隔离测试中的审查证据",
              },
            ],
            findings: [],
          },
          comment: "Same fixed acceptance checks passed",
        },
        { userId: null, agentId: context.reviewer, runId: reviewerRunId },
      );
      await db
        .update(heartbeatRuns)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, reviewerRunId));
      await context.store.markIssueChanged(
        context.companyId,
        run.nodes.review.issueId!,
      );
      await context.engine.sweepPending();
    }
    const evaluations = await db
      .select()
      .from(workflowEvaluations)
      .where(eq(workflowEvaluations.candidateRevisionId, revision.id));
    expect(evaluations).toHaveLength(3);
    expect(evaluations.every((item) => item.passed)).toBe(true);
    // Model a crash after the terminal task commit but before its evaluation.
    await db
      .update(workflowEvaluations)
      .set({ passed: false, findings: ["Candidate execution pending"] })
      .where(eq(workflowEvaluations.id, evaluations[0].id));
    await db
      .update(workflowRuns)
      .set({ needsReconcile: true })
      .where(eq(workflowRuns.id, evaluations[0].candidateRunId));
    const recovered = workflowEngine(db, {
      wakeup: context.wakeup,
      cancelRun: context.cancelRun,
    });
    await recovered.recover();
    await recovered.sweepPending();
    expect(
      (
        await db
          .select()
          .from(workflowEvaluations)
          .where(eq(workflowEvaluations.id, evaluations[0].id))
      )[0].passed,
    ).toBe(true);
    await context.store.evaluate(
      context.companyId,
      revision.id,
      {
        baselineRunId: baselineIds[0],
        candidateRunId: trials[0].runId,
        scenarioKey: "A different label is not another scenario",
      },
      context.userId,
    );
    expect(
      await db
        .select()
        .from(workflowEvaluations)
        .where(eq(workflowEvaluations.candidateRevisionId, revision.id)),
    ).toHaveLength(3);
    expect(
      (
        await context.store.publish(
          context.companyId,
          revision.id,
          context.userId,
        )
      ).status,
    ).toBe("published");
    expect((await context.read()).snapshot.revisionId).toBeNull();
  }, 45_000);

  it("人工验收跨长时间等待仍可决定，冻结时不被超时扫描停止", async () => {
    const context = await setup();
    const original = await context.read();
    original.snapshot.definition.nodes.find(
      (node) => node.id === "review",
    )!.binding = { kind: "human" };
    original.nodes.review.agentId = null;
    original.nodes.review.userId = context.userId;
    await db
      .update(workflowRuns)
      .set({ snapshot: original.snapshot, nodes: original.nodes })
      .where(eq(workflowRuns.id, original.id));
    await context.engine.sweepPending();
    await completeExecution(context);
    const waiting = await context.read();
    expect(waiting.nodes.review.userId).toBe(context.userId);
    expect(waiting.runtime.humanWaitStartedAt).toBeTruthy();
    // 模拟两小时人工等待，开始等待时还有一分钟执行额度。
    const started = Date.now() - 7_200_000;
    await db
      .update(workflowRuns)
      .set({
        deadlineAt: new Date(started + 60_000),
        runtime: {
          ...waiting.runtime,
          humanWaitStartedAt: new Date(started).toISOString(),
        },
        needsReconcile: false,
      })
      .where(eq(workflowRuns.id, waiting.id));
    await context.engine.sweepPending();
    expect((await context.read()).status).toBe("running");
    await expect(
      assertWorkflowIssueExecutionAllowed(
        db,
        context.companyId,
        waiting.nodes.review.issueId!,
      ),
    ).resolves.toBeUndefined();
    await context.engine.decide(
      context.companyId,
      context.parent.id,
      {
        expectedVersion: waiting.version,
        nodeId: "review",
        attempt: waiting.nodes.review.attempt,
        outcome: "passed",
        comment: "人工完成独立验收",
      },
      { userId: context.userId, agentId: null, runId: null },
    );
    await context.engine.sweepPending();
    const completed = await context.read();
    expect(completed.status).toBe("succeeded");
    expect(completed.runtime.humanWaitStartedAt).toBeUndefined();
    expect(completed.deadlineAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("超时后追加时间续跑原任务，保留快照并拒绝重复版本与超额授权", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    const original = await context.read();
    await db
      .update(workflowRuns)
      .set({ deadlineAt: new Date(Date.now() - 1000), needsReconcile: true })
      .where(eq(workflowRuns.id, original.id));
    await context.engine.sweepPending();
    const stopped = await context.read();
    const input = {
      action: "extend" as const,
      expectedVersion: stopped.version,
      reason: "人工同意追加半小时",
      extension: {
        additionalAttempts: 1,
        additionalMinutes: 30,
        additionalCostCents: 0,
      },
    };
    await expect(
      context.engine.control(
        context.companyId,
        context.parent.id,
        { ...input, extension: { ...input.extension, additionalAttempts: 9 } },
        context.userId,
      ),
    ).rejects.toThrow("Total allowances");
    expect((await context.read()).runtime.grants).toBeUndefined();
    await context.engine.control(
      context.companyId,
      context.parent.id,
      input,
      context.userId,
    );
    const resumed = await context.read();
    expect(resumed.id).toBe(original.id);
    expect(resumed.snapshot).toEqual(original.snapshot);
    expect(resumed.nodes.execute.issueId).toBe(original.nodes.execute.issueId);
    expect(resumed.status).toBe("running");
    expect(resumed.deadlineAt.getTime() - Date.now()).toBeGreaterThan(
      29 * 60_000,
    );
    expect(resumed.runtime.grants).toHaveLength(1);
    expect(resumed.runtime.grants![0].userId).toBe(context.userId);
    await expect(
      context.engine.control(
        context.companyId,
        context.parent.id,
        input,
        context.userId,
      ),
    ).rejects.toThrow("changed");
  });

  it("重试耗尽后可增加次数，继续新的尝试且保留失败证据", async () => {
    const context = await setup();
    const original = await context.read();
    original.snapshot.limits.maxAttempts = 1;
    await db
      .update(workflowRuns)
      .set({ snapshot: original.snapshot, nodes: original.nodes })
      .where(eq(workflowRuns.id, original.id));
    await context.engine.sweepPending();
    const running = await context.read();
    await db.insert(heartbeatRuns).values({
      companyId: context.companyId,
      agentId: context.executor,
      issueId: running.nodes.execute.issueId,
      status: "failed",
      error: "compile failed",
    });
    await context.store.markIssueChanged(
      context.companyId,
      running.nodes.execute.issueId!,
    );
    await context.engine.sweepPending();
    const stopped = await context.read();
    expect(stopped.status).toBe("waiting_human");
    await expect(
      context.engine.control(
        context.companyId,
        context.parent.id,
        {
          action: "resume",
          expectedVersion: stopped.version,
          reason: "普通恢复不增加额度",
        },
        context.userId,
      ),
    ).rejects.toThrow("retry ceiling");
    await context.engine.control(
      context.companyId,
      context.parent.id,
      {
        action: "extend",
        expectedVersion: stopped.version,
        reason: "允许一次修复",
        extension: {
          additionalAttempts: 1,
          additionalMinutes: 0,
          additionalCostCents: 0,
        },
      },
      context.userId,
    );
    await context.engine.sweepPending();
    const resumed = await context.read();
    expect(resumed.nodes.execute.attempt).toBe(2);
    expect(resumed.nodes.execute.issueId).not.toBe(
      running.nodes.execute.issueId,
    );
    expect(resumed.snapshot.limits.maxAttempts).toBe(1);
    const evidence = await db
      .select()
      .from(workflowNodeAttempts)
      .where(
        and(
          eq(workflowNodeAttempts.runId, running.id),
          eq(workflowNodeAttempts.nodeId, "execute"),
        ),
      );
    expect(evidence.find((attempt) => attempt.attempt === 1)?.status).toBe(
      "failed",
    );
  });

  it("相同错误连续三次转人工，人工确认后不会重新累计旧失败", async () => {
    const context = await setup();
    await context.engine.sweepPending();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const running = await context.read();
      expect(running.nodes.execute.attempt).toBe(attempt);
      await db.insert(heartbeatRuns).values({
        companyId: context.companyId,
        agentId: context.executor,
        issueId: running.nodes.execute.issueId,
        status: "failed",
        error: "unchanged build failure",
      });
      await context.store.markIssueChanged(
        context.companyId,
        running.nodes.execute.issueId!,
      );
      await context.engine.sweepPending();
    }
    const stopped = await context.read();
    expect(stopped.status).toBe("waiting_human");
    expect(stopped.stopReason).toContain("Repeated failure");
    expect(stopped.runtime.repeatedFailures?.execute.consecutive).toBe(3);
    await context.engine.control(
      context.companyId,
      context.parent.id,
      {
        action: "resume",
        expectedVersion: stopped.version,
        reason: "已修复外部依赖，继续尝试",
      },
      context.userId,
    );
    await context.engine.sweepPending();
    const resumed = await context.read();
    expect(resumed.status).toBe("running");
    expect(resumed.nodes.execute.attempt).toBe(4);
    expect(resumed.runtime.repeatedFailures?.execute.consecutive).toBe(0);
  });

  it("Agent 不能修改平台上限或自行追加额度", async () => {
    const context = await setup();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "agent",
        agentId: context.executor,
        companyId: context.companyId,
      };
      next();
    });
    app.use("/api", workflowRoutes(db, context.engine));
    app.use(errorHandler);
    const run = await context.read();
    expect(
      (
        await request(app)
          .put("/api/instance/workflows/defaults")
          .send({
            expectedVersion: 1,
            policy: { limits: { maxAttempts: 10 } },
            allowHostCommands: false,
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/issues/${context.parent.id}/workflow/control`)
          .send({
            action: "extend",
            expectedVersion: run.version,
            reason: "不能自行授权",
            extension: { additionalMinutes: 30 },
          })
      ).status,
    ).toBe(403);
  });
});
