import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import {
  agents,
  companies,
  companyMemberships,
  costEvents,
  heartbeatRuns,
  issues,
  projects,
  issueAccessGrants,
  workflowNodeAttempts,
  workflowRuns,
  workflowEvaluations,
  workflowTemplateRevisions,
  signalDatabaseWork,
  type Db,
} from "@paperclipai/db";
import {
  readyWorkflowNodes,
  workflowRepairNodes,
  workflowAncestorIds,
  workflowReviewError,
  type WorkflowReviewReport,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import {
  issueService,
  listUnfinalizedExecutionWorkspaceIds,
} from "../issues.js";
import { issueTreeControlService } from "../issue-tree-control.js";
import {
  workflowTransaction,
  type WorkflowTransaction,
} from "./transaction.js";
import { runWorkflowCheck } from "./checks.js";
import {
  runningProcesses,
  signalRunningProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { redactSensitiveText } from "../../redaction.js";
import { WORKFLOW_QUEUE } from "./admission.js";
import { workflowStore } from "./store.js";
import {
  workflowHandoffInstructions,
  workflowReviewFeedback,
} from "./handoff.js";

type Run = typeof workflowRuns.$inferSelect;
type Attempt = typeof workflowNodeAttempts.$inferSelect;
type CheckWork = {
  attempt: Attempt;
  tasks: (typeof issues.$inferSelect)[];
  remainingSeconds: number;
};
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Effects = {
  wakeup: (
    agentId: string,
    options: {
      source: "assignment";
      reason: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
      requestedByActorType: "system";
      requestedByActorId: string;
      contextSnapshot: Record<string, unknown>;
    },
  ) => Promise<unknown>;
  cancelRun: (runId: string, reason?: string) => Promise<unknown>;
};

export function workflowEngine(db: Db, effects: Effects) {
  const tasks = issueService(db);
  const ownerToken = randomUUID();
  const activeChecks = new Map<string, AbortController>();
  let nextDeadline: number | null = null;

  async function save(tx: Transaction, run: Run) {
    run.version += 1;
    run.updatedAt = new Date();
    await tx
      .update(workflowRuns)
      .set({
        status: run.status,
        version: run.version,
        nodes: run.nodes,
        stopReason: run.stopReason,
        pauseHoldId: run.pauseHoldId,
        cancelRunIds: run.cancelRunIds,
        cancelCheckIds: run.cancelCheckIds,
        deadlineAt: run.deadlineAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        // Keep terminal post-processing durable across a crash after this commit.
        needsReconcile: ["succeeded", "cancelled"].includes(run.status),
        updatedAt: run.updatedAt,
      })
      .where(eq(workflowRuns.id, run.id));
  }

  async function queueStops(
    tx: Transaction,
    run: Run,
    selected = Object.keys(run.nodes),
  ) {
    const selectedStates = selected.map((id) => run.nodes[id]);
    const ids: string[] = [];
    const treeControl = issueTreeControlService(tx as unknown as Db);
    for (const state of selectedStates) {
      if (!state.issueId) continue;
      if (state.status === "running" && state.agentId) state.interrupted = true;
      ids.push(
        ...(await treeControl.listTreeIssues(run.companyId, state.issueId)).map(
          (task) => task.id,
        ),
      );
      await treeControl.cancelUnclaimedWakeupsForTree(
        run.companyId,
        state.issueId,
        "Workflow stopped or superseded this attempt",
      );
    }
    if (ids.length) {
      const active = await tx
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, run.companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
            or(
              inArray(heartbeatRuns.issueId, ids),
              inArray(heartbeatRuns.nativeIssueId, ids),
              sql`${heartbeatRuns.contextSnapshot}->>'issueId' in (${sql.join(
                ids.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            ),
          ),
        );
      run.cancelRunIds = [
        ...new Set([...run.cancelRunIds, ...active.map((item) => item.id)]),
      ];
    }
    const checks = await tx
      .select({ id: workflowNodeAttempts.id })
      .from(workflowNodeAttempts)
      .where(
        and(
          eq(workflowNodeAttempts.runId, run.id),
          inArray(workflowNodeAttempts.nodeId, selected),
          eq(workflowNodeAttempts.status, "running"),
          sql`${workflowNodeAttempts.ownerToken} is not null`,
        ),
      );
    run.cancelCheckIds = [
      ...new Set([...run.cancelCheckIds, ...checks.map((item) => item.id)]),
    ];
  }

  async function holdWorkflow(tx: Transaction, run: Run, reason: string) {
    if (run.pauseHoldId) return;
    const { hold } = await issueTreeControlService(
      tx as unknown as Db,
    ).createHold(run.companyId, run.issueId, {
      mode: "pause",
      reason,
      actor: { actorType: "system", actorId: "native-workflows" },
    });
    run.pauseHoldId = hold.id;
  }

  async function drainStops(runId: string) {
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    if (!run) return;
    for (const id of run.cancelRunIds)
      await effects.cancelRun(
        id,
        "Workflow stopped or superseded this attempt",
      );
    for (const id of run.cancelCheckIds) {
      activeChecks.get(id)?.abort();
      const process = runningProcesses.get(id);
      if (process) signalRunningProcess(process, "SIGKILL");
    }
    if (run.cancelRunIds.length || run.cancelCheckIds.length) {
      await workflowTransaction(db, async (context) => {
        const { tx } = context;
        const [current] = await tx
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, runId))
          .for("update");
        if (!current) return;
        await tx
          .update(workflowRuns)
          .set({
            cancelRunIds: current.cancelRunIds.filter(
              (id) => !run.cancelRunIds.includes(id),
            ),
            cancelCheckIds: current.cancelCheckIds.filter(
              (id) => !run.cancelCheckIds.includes(id),
            ),
          })
          .where(eq(workflowRuns.id, runId));
      });
    }
  }

  async function stop(context: WorkflowTransaction, run: Run, reason: string) {
    const { tx } = context;
    run.status = "waiting_human";
    run.stopReason = reason;
    await holdWorkflow(tx, run, reason);
    await queueStops(tx, run);
    await context.updateIssue(run.issueId, {
      status: "in_review",
      companyGuard: run.companyId,
    });
    await context.activity({
      companyId: run.companyId,
      actorType: "system",
      actorId: "native-workflows",
      action: "workflow.stopped",
      entityType: "issue",
      entityId: run.issueId,
      details: { workflowRunId: run.id, reason },
    });
  }

  async function failAttempt(
    tx: Transaction,
    run: Run,
    nodeId: string,
    reason: string,
  ) {
    const state = run.nodes[nodeId];
    state.status = "failed";
    state.result = reason;
    state.finishedAt = new Date().toISOString();
    await tx
      .update(workflowNodeAttempts)
      .set({
        status: "failed",
        finishedAt: new Date(),
        evidence: sql`coalesce(${workflowNodeAttempts.evidence}, '{}'::jsonb) || ${JSON.stringify({ failure: reason })}::jsonb`,
      })
      .where(
        and(
          eq(workflowNodeAttempts.runId, run.id),
          eq(workflowNodeAttempts.nodeId, nodeId),
          eq(workflowNodeAttempts.attempt, state.attempt),
          inArray(workflowNodeAttempts.status, ["running", "passed"]),
        ),
      );
  }

  async function repair(
    context: WorkflowTransaction,
    run: Run,
    nodeId: string,
    reason: string,
  ) {
    const { tx } = context;
    await failAttempt(tx, run, nodeId, reason);
    const node = run.snapshot.definition.nodes.find(
      (item) => item.id === nodeId,
    )!;
    const target = node.onFailure ?? (node.kind === "task" ? node.id : null);
    if (
      !target ||
      run.nodes[target].attempt >= run.snapshot.limits.maxAttempts
    ) {
      await stop(context, run, `Retry limit reached: ${reason}`);
      return;
    }
    const reset = workflowRepairNodes(run.snapshot.definition, target);
    await queueStops(tx, run, reset);
    for (const id of reset) {
      const previous = run.nodes[id];
      if (previous.issueId) {
        // Superseded work can finish only into its old attempt. The new attempt
        // has a new task identity, so late decisions cannot advance the graph.
        const [oldTask] = await tx
          .select({ status: issues.status })
          .from(issues)
          .where(
            and(
              eq(issues.id, previous.issueId),
              eq(issues.companyId, run.companyId),
            ),
          );
        if (oldTask && !["done", "cancelled"].includes(oldTask.status))
          await context.updateIssue(previous.issueId, {
            status: "cancelled",
            companyGuard: run.companyId,
          });
        await tx
          .update(workflowNodeAttempts)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(
            and(
              eq(workflowNodeAttempts.runId, run.id),
              eq(workflowNodeAttempts.nodeId, id),
              eq(workflowNodeAttempts.attempt, previous.attempt),
              eq(workflowNodeAttempts.status, "running"),
            ),
          );
      }
      run.nodes[id] = {
        ...previous,
        status: "pending",
        issueId: null,
        startedAt: null,
        finishedAt: null,
        result: reason,
      };
    }
  }

  async function resumeInterruptedNodes(
    context: WorkflowTransaction,
    run: Run,
  ) {
    const interrupted = Object.values(run.nodes).filter(
      (node) => node.status === "running" && node.interrupted && node.issueId,
    );
    const ids = interrupted.map((node) => node.issueId!);
    const active = ids.length
      ? await context.tx
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, run.companyId),
              inArray(heartbeatRuns.status, ["running", "queued"]),
              or(
                inArray(heartbeatRuns.issueId, ids),
                inArray(heartbeatRuns.nativeIssueId, ids),
              ),
            ),
          )
          .limit(1)
      : [];
    if (active.length) return false;
    for (const node of interrupted) {
      node.resumeGeneration = (node.resumeGeneration ?? 0) + 1;
      node.interrupted = false;
      node.startedAt = new Date().toISOString();
      await context.updateIssue(node.issueId!, {
        status: "todo",
        companyGuard: run.companyId,
      });
    }
    return true;
  }

  async function cancelNodes(context: WorkflowTransaction, run: Run) {
    const tree = await issueTreeControlService(
      context.tx as unknown as Db,
    ).listTreeIssues(run.companyId, run.issueId);
    for (const task of tree) {
      if (!["done", "cancelled"].includes(task.status))
        await context.updateIssue(task.id, {
          status: "cancelled",
          companyGuard: run.companyId,
        });
    }
    for (const state of Object.values(run.nodes)) {
      if (["running", "pending"].includes(state.status)) {
        state.status = "cancelled";
        state.finishedAt = new Date().toISOString();
        state.result = run.stopReason;
      }
    }
    await context.tx
      .update(workflowNodeAttempts)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(
          eq(workflowNodeAttempts.companyId, run.companyId),
          eq(workflowNodeAttempts.runId, run.id),
          eq(workflowNodeAttempts.status, "running"),
        ),
      );
  }

  async function performChecks(item: CheckWork, signal?: AbortSignal) {
    const controller = new AbortController();
    activeChecks.set(item.attempt.id, controller);
    const checkSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    return (async () => {
      const [run] = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, item.attempt.runId));
      const state = run?.nodes[item.attempt.nodeId];
      if (
        !run ||
        run.status !== "running" ||
        state?.status !== "running" ||
        state.attempt !== item.attempt.attempt
      )
        return null;
      const [claim] = await db
        .select({ ownerToken: workflowNodeAttempts.ownerToken })
        .from(workflowNodeAttempts)
        .where(eq(workflowNodeAttempts.id, item.attempt.id));
      if (claim?.ownerToken !== ownerToken) return null;
      const node = run.snapshot.definition.nodes.find(
        (candidate) => candidate.id === item.attempt.nodeId,
      )!;
      const results = [];
      for (const task of item.tasks) {
        results.push(
          await runWorkflowCheck(db, {
            companyId: run.companyId,
            attemptId: item.attempt.id,
            issueId: task.id,
            executionWorkspaceId: task.executionWorkspaceId,
            check: node.check!,
            remainingSeconds: Math.floor(
              (run.deadlineAt.getTime() - Date.now()) / 1000,
            ),
            signal: checkSignal,
          }).catch((error: unknown) => ({
            passed: false,
            retryable: false,
            summary:
              "Verification could not start; inspect workspace or command configuration",
            evidence: {
              error: redactSensitiveText(
                error instanceof Error ? error.message : String(error),
              ),
            },
          })),
        );
        if (checkSignal.aborted) break;
      }
      return {
        run,
        node,
        result: {
          passed:
            results.length === item.tasks.length &&
            results.every((result) => result.passed),
          retryable: results.every((result) => result.retryable),
          summary: results.map((result) => result.summary).join("; "),
          evidence: {
            inputs: results.map((result, index) => ({
              issueId: item.tasks[index].id,
              ...result.evidence,
            })),
          },
        },
      };
    })().finally(() => activeChecks.delete(item.attempt.id));
  }

  async function reconcile(runId: string, signal?: AbortSignal) {
    await drainStops(runId);
    const wake: { agentId: string; issueId: string; key: string }[] = [];
    const checks: {
      attempt: Attempt;
      tasks: (typeof issues.$inferSelect)[];
      remainingSeconds: number;
    }[] = [];
    const [lookup] = await db
      .select({
        issueId: workflowRuns.issueId,
        companyId: workflowRuns.companyId,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    if (!lookup) return;
    await workflowTransaction(db, async (context) => {
      const { tx } = context;
      // Global order: parent issue -> workflow -> child issue -> run.
      const [parent] = await tx
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.id, lookup.issueId),
            eq(issues.companyId, lookup.companyId),
          ),
        )
        .for("update");
      const [run] = await tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.companyId, lookup.companyId),
          ),
        )
        .for("update");
      if (!parent || !run || ["succeeded", "cancelled"].includes(run.status))
        return;
      const [company] = await tx
        .select({ status: companies.status })
        .from(companies)
        .where(eq(companies.id, run.companyId));
      const [project] = parent.projectId
        ? await tx
            .select({
              status: projects.status,
              pauseReason: projects.pauseReason,
            })
            .from(projects)
            .where(
              and(
                eq(projects.id, parent.projectId),
                eq(projects.companyId, run.companyId),
              ),
            )
        : [];
      const hold = await issueTreeControlService(
        tx as unknown as Db,
      ).getActivePauseHoldGate(run.companyId, parent.id);
      if (
        parent.status === "blocked" &&
        ["running", "pending"].includes(run.status)
      ) {
        await stop(
          context,
          run,
          "Parent task is blocked; resolve its blocker before resuming",
        );
        await save(tx, run);
        return;
      }
      if (
        parent.status === "cancelled" ||
        parent.hiddenAt ||
        company?.status === "archived" ||
        project?.status === "cancelled"
      ) {
        run.status = "cancelled";
        run.finishedAt = new Date();
        run.stopReason = "Parent task or company was cancelled";
        await queueStops(tx, run);
        await cancelNodes(context, run);
        await save(tx, run);
        return;
      }
      if (
        hold ||
        company?.status === "paused" ||
        project?.pauseReason ||
        (parent.status === "backlog" && run.startedAt)
      ) {
        if (["running", "pending"].includes(run.status)) {
          await queueStops(tx, run);
          run.status = "paused";
          run.stopReason = "parent_paused";
          await save(tx, run);
        } else
          await tx
            .update(workflowRuns)
            .set({ needsReconcile: false })
            .where(eq(workflowRuns.id, run.id));
        return;
      }
      if (run.status === "paused" && run.stopReason === "parent_paused") {
        if (!(await resumeInterruptedNodes(context, run))) {
          await tx
            .update(workflowRuns)
            .set({ needsReconcile: false })
            .where(eq(workflowRuns.id, run.id));
          return;
        }
        run.deadlineAt = new Date(
          run.deadlineAt.getTime() + Date.now() - run.updatedAt.getTime(),
        );
        run.status = run.startedAt ? "running" : "pending";
        run.stopReason = null;
      }
      if (
        ["paused", "waiting_human"].includes(run.status) ||
        parent.status === "backlog"
      ) {
        await tx
          .update(workflowRuns)
          .set({ needsReconcile: false })
          .where(eq(workflowRuns.id, run.id));
        return;
      }
      if (!run.startedAt) {
        run.startedAt = new Date();
        run.deadlineAt = new Date(
          Date.now() + run.snapshot.limits.timeoutMinutes * 60_000,
        );
        run.status = "running";
        await context.updateIssue(parent.id, {
          status: "in_progress",
          companyGuard: run.companyId,
        });
      }
      if (run.deadlineAt.getTime() <= Date.now()) {
        await stop(context, run, "Workflow deadline reached");
        await save(tx, run);
        return;
      }
      if (run.snapshot.limits.maxCostCents !== null) {
        const taskIds = (
          await issueTreeControlService(tx as unknown as Db).listTreeIssues(
            run.companyId,
            run.issueId,
          )
        ).map((task) => task.id);
        const [spend] = taskIds.length
          ? await tx
              .select({
                cents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)`,
                unpriced: sql<number>`count(*) filter (where ${costEvents.costStatus} = 'unpriced' and ${costEvents.billingType} <> 'subscription_included')`,
              })
              .from(costEvents)
              .where(
                and(
                  eq(costEvents.companyId, run.companyId),
                  inArray(costEvents.issueId, taskIds),
                ),
              )
          : [];
        if (Number(spend?.unpriced ?? 0) > 0) {
          await stop(
            context,
            run,
            "Reported usage is unpriced; the workflow cost ceiling cannot be verified",
          );
          await save(tx, run);
          return;
        }
        if (Number(spend?.cents ?? 0) >= run.snapshot.limits.maxCostCents) {
          await stop(context, run, "Workflow cost ceiling reached");
          await save(tx, run);
          return;
        }
      }
      for (const node of run.snapshot.definition.nodes) {
        const current = run.nodes[node.id];
        if (current.status !== "running") continue;
        if (node.kind === "check") {
          const [attempt] = await tx
            .select()
            .from(workflowNodeAttempts)
            .where(
              and(
                eq(workflowNodeAttempts.runId, run.id),
                eq(workflowNodeAttempts.nodeId, node.id),
                eq(workflowNodeAttempts.attempt, current.attempt),
              ),
            );
          if (
            attempt?.leaseExpiresAt &&
            attempt.leaseExpiresAt.getTime() <= Date.now()
          ) {
            current.status = "failed";
            await tx
              .update(workflowNodeAttempts)
              .set({
                status: "failed",
                evidence: {
                  interrupted: true,
                  summary:
                    "Verification ownership lease expired without a result",
                },
                finishedAt: new Date(),
              })
              .where(eq(workflowNodeAttempts.id, attempt.id));
            if (
              node.check?.kind === "evidence" ||
              (node.check?.kind === "command" && node.check.retrySafe)
            )
              await repair(
                context,
                run,
                node.id,
                "Interrupted retry-safe verification",
              );
            else
              await stop(
                context,
                run,
                "Verification outcome is unknown; no automatic command replay is permitted",
              );
            break;
          }
          continue;
        }
        if (!current.issueId) continue;
        const [task] = await tx
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.id, current.issueId),
              eq(issues.companyId, run.companyId),
            ),
          );
        if (!task) {
          await stop(context, run, `Node task missing: ${node.id}`);
          break;
        }
        if (current.agentId && task.status !== "done") {
          const [agent] = await tx
            .select({ status: agents.status })
            .from(agents)
            .where(
              and(
                eq(agents.companyId, run.companyId),
                eq(agents.id, current.agentId),
              ),
            );
          if (
            !agent ||
            ["paused", "terminated", "pending_approval"].includes(agent.status)
          ) {
            await stop(
              context,
              run,
              `Activate or configure the assigned agent for ${node.id}`,
            );
            break;
          }
        }
        if (
          task.assigneeAgentId !== current.agentId ||
          task.assigneeUserId !== current.userId
        ) {
          await stop(context, run, `Node assignment changed: ${node.id}`);
          break;
        }
        if (["blocked", "cancelled"].includes(task.status)) {
          await stop(
            context,
            run,
            `Node needs intervention: ${node.id} (${task.status})`,
          );
          break;
        }
        const [latestRun] = await tx
          .select()
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, run.companyId),
              or(
                eq(heartbeatRuns.issueId, task.id),
                eq(heartbeatRuns.nativeIssueId, task.id),
                sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${task.id}`,
              ),
            ),
          )
          .orderBy(sql`${heartbeatRuns.createdAt} desc`)
          .limit(1);
        const lastRun =
          current.resumeGeneration &&
          latestRun &&
          latestRun.createdAt.getTime() < new Date(current.startedAt!).getTime()
            ? undefined
            : latestRun;
        if (task.status === "todo" && current.agentId && !lastRun) {
          const [attempt] = await tx
            .select({ id: workflowNodeAttempts.id })
            .from(workflowNodeAttempts)
            .where(
              and(
                eq(workflowNodeAttempts.runId, run.id),
                eq(workflowNodeAttempts.nodeId, node.id),
                eq(workflowNodeAttempts.attempt, current.attempt),
              ),
            );
          if (attempt)
            wake.push({
              agentId: current.agentId,
              issueId: task.id,
              key: `${attempt.id}:${current.resumeGeneration ?? 0}`,
            });
        }
        if (node.kind !== "task") {
          const [attempt] = await tx
            .select({ status: workflowNodeAttempts.status })
            .from(workflowNodeAttempts)
            .where(
              and(
                eq(workflowNodeAttempts.runId, run.id),
                eq(workflowNodeAttempts.nodeId, node.id),
                eq(workflowNodeAttempts.attempt, current.attempt),
              ),
            );
          if (attempt?.status === "passed" && lastRun?.status === "succeeded") {
            if (
              task.executionWorkspaceId &&
              (
                await listUnfinalizedExecutionWorkspaceIds(tx, run.companyId, [
                  task.executionWorkspaceId,
                ])
              ).size
            )
              continue;
            current.status = "passed";
            current.finishedAt = new Date().toISOString();
          } else if (
            lastRun &&
            ["failed", "timed_out", "cancelled", "succeeded"].includes(
              lastRun.status,
            )
          ) {
            await failAttempt(
              tx,
              run,
              node.id,
              `Reviewer exited without a settled successful verdict: ${node.id}`,
            );
            await stop(
              context,
              run,
              `Reviewer exited without a settled successful verdict: ${node.id}`,
            );
          }
          continue;
        }
        if (task.status === "done") {
          if (lastRun && ["queued", "running"].includes(lastRun.status))
            continue;
          if (current.agentId && lastRun?.status !== "succeeded") {
            await repair(
              context,
              run,
              node.id,
              "No successful execution receipt for completed task",
            );
            break;
          }
          if (
            task.executionWorkspaceId &&
            (
              await listUnfinalizedExecutionWorkspaceIds(tx, run.companyId, [
                task.executionWorkspaceId,
              ])
            ).size
          )
            continue;
          current.status = "passed";
          current.finishedAt = new Date().toISOString();
          current.result = "Task completed with a retained execution receipt";
          await tx
            .update(workflowNodeAttempts)
            .set({
              status: "passed",
              evidence: { runId: lastRun?.id ?? null },
              finishedAt: new Date(),
            })
            .where(
              and(
                eq(workflowNodeAttempts.runId, run.id),
                eq(workflowNodeAttempts.nodeId, node.id),
                eq(workflowNodeAttempts.attempt, current.attempt),
              ),
            );
        } else if (
          lastRun &&
          ["failed", "timed_out", "cancelled"].includes(lastRun.status)
        ) {
          if (
            /configuration|auth|permission|credential/i.test(
              lastRun.errorCode ?? "",
            )
          )
            await stop(
              context,
              run,
              `Execution configuration requires attention: ${node.id}`,
            );
          else
            await repair(
              context,
              run,
              node.id,
              lastRun.error ?? "Execution failed",
            );
          break;
        }
      }
      if (run.status !== "running") {
        await save(tx, run);
        return;
      }
      for (const node of readyWorkflowNodes(
        run.snapshot.definition,
        run.nodes,
        run.snapshot.limits.maxParallelism,
      )) {
        const current = run.nodes[node.id];
        if (node.kind === "review" && current.agentId) {
          const inputIds: string[] = [];
          for (const id of workflowAncestorIds(
            run.snapshot.definition,
            node.id,
          )) {
            const input = run.snapshot.definition.nodes.find(
              (candidate) => candidate.id === id,
            )!;
            const sourceId = run.nodes[id].issueId;
            if (input.kind === "task" && sourceId)
              inputIds.push(
                ...(
                  await issueTreeControlService(
                    tx as unknown as Db,
                  ).listTreeIssues(run.companyId, sourceId)
                ).map((task) => task.id),
              );
          }
          const contributors = inputIds.length
            ? await tx
                .select({ agentId: heartbeatRuns.agentId })
                .from(heartbeatRuns)
                .where(
                  and(
                    eq(heartbeatRuns.companyId, run.companyId),
                    or(
                      inArray(heartbeatRuns.issueId, inputIds),
                      inArray(heartbeatRuns.nativeIssueId, inputIds),
                      sql`${heartbeatRuns.contextSnapshot}->>'issueId' in (${sql.join(
                        inputIds.map((id) => sql`${id}`),
                        sql`, `,
                      )})`,
                    ),
                  ),
                )
            : [];
          if (
            contributors.some(
              (contributor) => contributor.agentId === current.agentId,
            )
          ) {
            if (node.binding.kind === "agent") {
              await stop(
                context,
                run,
                `The pinned reviewer contributed to this implementation: ${node.id}`,
              );
              break;
            }
            const excluded = [
              ...new Set([
                run.snapshot.executorAgentId,
                ...contributors.map((contributor) => contributor.agentId),
              ]),
            ];
            const [replacement] =
              node.binding.kind === "role"
                ? await tx
                    .select({ id: agents.id })
                    .from(agents)
                    .where(
                      and(
                        eq(agents.companyId, run.companyId),
                        eq(agents.role, node.binding.role),
                        inArray(agents.status, ["active", "idle", "running"]),
                        sql`${agents.id} not in (${sql.join(
                          excluded.map((id) => sql`${id}`),
                          sql`, `,
                        )})`,
                      ),
                    )
                    .orderBy(asc(agents.createdAt), asc(agents.id))
                    .limit(1)
                : [];
            current.agentId = replacement?.id ?? null;
            current.userId = replacement
              ? null
              : run.snapshot.responsibleUserId;
            await context.activity({
              companyId: run.companyId,
              actorType: "system",
              actorId: "native-workflows",
              action: "workflow.independent_reviewer_resolved",
              entityType: "issue",
              entityId: run.issueId,
              details: {
                workflowRunId: run.id,
                nodeId: node.id,
                agentId: current.agentId,
                userId: current.userId,
              },
            });
          }
        }
        if (current.attempt >= run.snapshot.limits.maxAttempts) {
          await stop(context, run, `Retry limit reached: ${node.id}`);
          break;
        }
        if (current.agentId) {
          const [agent] = await tx
            .select({ status: agents.status })
            .from(agents)
            .where(
              and(
                eq(agents.id, current.agentId),
                eq(agents.companyId, run.companyId),
              ),
            );
          if (
            !agent ||
            ["paused", "terminated", "pending_approval"].includes(agent.status)
          ) {
            await stop(
              context,
              run,
              `Activate or configure the assigned agent for ${node.id}`,
            );
            break;
          }
        }
        if (current.userId) {
          const [member] = await tx
            .select({ id: companyMemberships.id })
            .from(companyMemberships)
            .where(
              and(
                eq(companyMemberships.companyId, run.companyId),
                eq(companyMemberships.principalType, "user"),
                eq(companyMemberships.principalId, current.userId),
                eq(companyMemberships.status, "active"),
              ),
            );
          if (!member) {
            await stop(
              context,
              run,
              `Restore the responsible user's active company membership for ${node.id}`,
            );
            break;
          }
        }
        current.attempt += 1;
        current.status = "running";
        current.startedAt = new Date().toISOString();
        current.finishedAt = null;
        if (node.kind !== "check") {
          const childId = randomUUID();
          const dependencyTasks = workflowAncestorIds(
            run.snapshot.definition,
            node.id,
          ).flatMap((id) =>
            run.nodes[id].issueId ? [run.nodes[id].issueId!] : [],
          );
          const [previousTask] =
            node.kind === "task"
              ? await tx
                  .select({ issueId: workflowNodeAttempts.issueId })
                  .from(workflowNodeAttempts)
                  .where(
                    and(
                      eq(workflowNodeAttempts.runId, run.id),
                      eq(workflowNodeAttempts.nodeId, node.id),
                    ),
                  )
                  .orderBy(sql`${workflowNodeAttempts.attempt} desc`)
                  .limit(1)
              : [];
          const verdictGuidance =
            node.kind === "review" || node.kind === "approval"
              ? `\nSubmit the verdict with POST /api/issues/${childId}/workflow/decisions using nodeId=${node.id}, attempt=${current.attempt}, current expectedVersion from GET /api/issues/${childId}/workflow, outcome=passed|failed and a concrete evidence comment. Do not mark this node Done directly. A stale 409 requires a fresh read, never a blind retry.`
              : "";
          const task = await tasks.create(
            run.companyId,
            {
              id: childId,
              title: `${parent.title} — ${node.title}`,
              description: `# Authorized objective\n${run.snapshot.objective.description ?? run.snapshot.objective.title}\n\n# Workflow node\n${node.instructions}${verdictGuidance}\n\n${workflowHandoffInstructions(run.snapshot, node)}\n\n# Inputs\n${dependencyTasks.map((id) => `- /api/issues/${id}`).join("\n")}\n\n# Previous feedback\n${current.result ?? "None"}\n\nStay inside the approved scope. Do not change acceptance criteria or workflow configuration. Escalate unavailable tools or access.`,
              initialPlan: run.snapshot.objective.plan,
              parentId: parent.id,
              projectId: parent.projectId,
              projectWorkspaceId: parent.projectWorkspaceId,
              goalId: parent.goalId,
              blockedByIssueIds: dependencyTasks,
              visibility: parent.visibility as "open" | "private",
              status: "todo",
              priority: parent.priority,
              assigneeAgentId: current.agentId,
              assigneeUserId: current.userId,
              responsibleUserId: run.snapshot.responsibleUserId,
              trustExplicitResponsibleUserId: true,
              createdByUserId: run.snapshot.responsibleUserId,
              originKind: "workflow_node",
              originId: run.id,
              originFingerprint: `${node.id}:${current.attempt}`,
              inheritExecutionWorkspaceFromIssueId:
                node.kind === "task"
                  ? (previousTask?.issueId ?? parent.id)
                  : (dependencyTasks[0] ?? parent.id),
              idempotencyKey: `workflow:${run.id}:${node.id}:${current.attempt}`,
            },
            tx,
          );
          current.issueId = task.id;
          if (
            current.agentId &&
            parent.visibility === "private" &&
            dependencyTasks.length
          ) {
            await tx
              .insert(issueAccessGrants)
              .values(
                dependencyTasks.map((issueId) => ({
                  issueId,
                  subjectType: "agent",
                  subjectId: current.agentId!,
                  source: "explicit",
                  grantedByUserId: run.snapshot.responsibleUserId,
                })),
              )
              .onConflictDoNothing();
          }
        }
        const leaseExpiresAt =
          node.kind === "check"
            ? new Date(
                Math.min(
                  run.deadlineAt.getTime(),
                  Date.now() +
                    ((node.check?.kind === "command"
                      ? node.check.timeoutSeconds
                      : 60) +
                      30) *
                      1000,
                ),
              )
            : null;
        const [attempt] = await tx
          .insert(workflowNodeAttempts)
          .values({
            companyId: run.companyId,
            runId: run.id,
            nodeId: node.id,
            attempt: current.attempt,
            issueId: current.issueId,
            status: "running",
            ownerToken: node.kind === "check" ? ownerToken : null,
            leaseExpiresAt,
          })
          .returning();
        if (current.agentId && current.issueId)
          wake.push({
            agentId: current.agentId,
            issueId: current.issueId,
            key: `${attempt.id}:${current.resumeGeneration ?? 0}`,
          });
        if (node.kind === "check") {
          const sourceIds = workflowAncestorIds(
            run.snapshot.definition,
            node.id,
          )
            .filter(
              (id) =>
                run.snapshot.definition.nodes.find((item) => item.id === id)!
                  .kind === "task",
            )
            .flatMap((id) =>
              run.nodes[id].issueId ? [run.nodes[id].issueId!] : [],
            );
          const inputs = sourceIds.length
            ? await tx
                .select()
                .from(issues)
                .where(
                  and(
                    inArray(issues.id, sourceIds),
                    eq(issues.companyId, run.companyId),
                  ),
                )
            : [];
          if (!inputs.length) {
            await stop(
              context,
              run,
              "Verification has no completed input task",
            );
            break;
          }
          checks.push({
            attempt,
            tasks: inputs,
            remainingSeconds: Math.max(
              1,
              Math.floor((run.deadlineAt.getTime() - Date.now()) / 1000),
            ),
          });
        }
      }
      if (Object.values(run.nodes).every((node) => node.status === "passed")) {
        run.status = "succeeded";
        run.finishedAt = new Date();
        run.stopReason = null;
        await context.updateIssue(parent.id, {
          status: "done",
          companyGuard: run.companyId,
        });
        await context.activity({
          companyId: run.companyId,
          actorType: "system",
          actorId: "native-workflows",
          action: "workflow.completed",
          entityType: "issue",
          entityId: run.issueId,
          details: { workflowRunId: run.id },
        });
      }
      await save(tx, run);
    });
    await drainStops(runId);
    for (const item of wake)
      await effects.wakeup(item.agentId, {
        source: "assignment",
        reason: "workflow_node_ready",
        idempotencyKey: `workflow:${item.key}:start`,
        requestedByActorType: "system",
        requestedByActorId: "native-workflows",
        payload: { issueId: item.issueId },
        contextSnapshot: {
          issueId: item.issueId,
          wakeReason: "workflow_node_ready",
        },
      });
    for (const item of checks) {
      const execution = await performChecks(item, signal);
      if (!execution) continue;
      const { run, node, result } = execution;
      await workflowTransaction(db, async (context) => {
        const { tx } = context;
        await tx
          .select({ id: issues.id })
          .from(issues)
          .where(
            and(
              eq(issues.id, run.issueId),
              eq(issues.companyId, run.companyId),
            ),
          )
          .for("update");
        const [currentRun] = await tx
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, run.id))
          .for("update");
        const state = currentRun?.nodes[node.id];
        if (
          !currentRun ||
          currentRun.status !== "running" ||
          state?.status !== "running" ||
          state.attempt !== item.attempt.attempt
        )
          return;
        const [claimedAttempt] = await tx
          .select({ ownerToken: workflowNodeAttempts.ownerToken })
          .from(workflowNodeAttempts)
          .where(eq(workflowNodeAttempts.id, item.attempt.id));
        if (claimedAttempt?.ownerToken !== ownerToken) return;
        state.status = result.passed ? "passed" : "failed";
        state.result = result.summary;
        state.finishedAt = new Date().toISOString();
        await tx
          .update(workflowNodeAttempts)
          .set({
            status: state.status,
            evidence: result.evidence,
            finishedAt: new Date(),
          })
          .where(eq(workflowNodeAttempts.id, item.attempt.id));
        if (!result.passed) {
          if (result.retryable)
            await repair(context, currentRun, node.id, result.summary);
          else await stop(context, currentRun, result.summary);
        }
        await save(tx, currentRun);
        await signalDatabaseWork(tx, WORKFLOW_QUEUE);
        await tx
          .update(workflowRuns)
          .set({ needsReconcile: currentRun.status === "running" })
          .where(eq(workflowRuns.id, currentRun.id));
      });
    }
    // Trials are evaluated from persisted outcomes, never an agent-supplied score.
    const evaluations = await db
      .select({ evaluation: workflowEvaluations })
      .from(workflowEvaluations)
      .innerJoin(
        workflowTemplateRevisions,
        eq(
          workflowTemplateRevisions.id,
          workflowEvaluations.candidateRevisionId,
        ),
      )
      .where(
        and(
          eq(workflowEvaluations.candidateRunId, runId),
          eq(workflowTemplateRevisions.status, "draft"),
        ),
      );
    for (const { evaluation } of evaluations)
      await workflowStore(db).evaluate(
        evaluation.companyId,
        evaluation.candidateRevisionId,
        {
          baselineRunId: evaluation.baselineRunId,
          candidateRunId: evaluation.candidateRunId,
          scenarioKey: evaluation.scenarioKey,
        },
        evaluation.createdByUserId,
      );
    await db
      .update(workflowRuns)
      .set({ needsReconcile: false })
      .where(
        and(
          eq(workflowRuns.id, runId),
          inArray(workflowRuns.status, ["succeeded", "cancelled"]),
        ),
      );
  }

  return {
    async sweepPending(signal?: AbortSignal) {
      const candidates = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(
          or(
            and(
              inArray(workflowRuns.status, ["succeeded", "cancelled"]),
              eq(workflowRuns.needsReconcile, true),
            ),
            and(
              inArray(workflowRuns.status, [
                "pending",
                "running",
                "paused",
                "waiting_human",
              ]),
              or(
                eq(workflowRuns.needsReconcile, true),
                and(
                  eq(workflowRuns.status, "running"),
                  lte(workflowRuns.deadlineAt, new Date()),
                ),
                sql`exists (select 1 from ${workflowNodeAttempts} where ${workflowNodeAttempts.runId} = ${workflowRuns.id} and ${workflowNodeAttempts.status} = 'running' and ${workflowNodeAttempts.leaseExpiresAt} <= now())`,
              ),
            ),
            sql`jsonb_array_length(${workflowRuns.cancelRunIds}) > 0 or jsonb_array_length(${workflowRuns.cancelCheckIds}) > 0`,
          ),
        )
        .orderBy(asc(workflowRuns.updatedAt))
        .limit(100);
      for (const candidate of candidates) {
        if (signal?.aborted) break;
        await reconcile(candidate.id, signal);
      }
      const [next] = await db
        .select({
          deadline: sql<string | null>`min(${workflowRuns.deadlineAt})`,
        })
        .from(workflowRuns)
        .where(eq(workflowRuns.status, "running"));
      const [lease] = await db
        .select({
          deadline: sql<
            string | null
          >`min(${workflowNodeAttempts.leaseExpiresAt})`,
        })
        .from(workflowNodeAttempts)
        .innerJoin(
          workflowRuns,
          eq(workflowRuns.id, workflowNodeAttempts.runId),
        )
        .where(
          and(
            eq(workflowRuns.status, "running"),
            eq(workflowNodeAttempts.status, "running"),
          ),
        );
      const deadlines = [next?.deadline, lease?.deadline].flatMap((value) =>
        value ? [new Date(value).getTime()] : [],
      );
      nextDeadline = deadlines.length ? Math.min(...deadlines) : null;
    },
    async hasPending() {
      const rows = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(
          and(
            inArray(workflowRuns.status, [
              "pending",
              "running",
              "paused",
              "waiting_human",
              "succeeded",
              "cancelled",
            ]),
            eq(workflowRuns.needsReconcile, true),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    nextRunAt: () => nextDeadline,
    async recover() {
      await workflowTransaction(db, async (context) => {
        const { tx } = context;
        await signalDatabaseWork(tx, WORKFLOW_QUEUE);
        // Active command attempts have an ambiguous result after host restart.
        // They must not be replayed merely because the process disappeared.
        await tx
          .update(workflowRuns)
          .set({ needsReconcile: true })
          .where(
            inArray(workflowRuns.status, [
              "pending",
              "running",
              "paused",
              "waiting_human",
            ]),
          );
      });
    },
    async decide(
      companyId: string,
      issueId: string,
      input: {
        nodeId: string;
        attempt: number;
        expectedVersion: number;
        outcome: "passed" | "failed";
        comment: string;
        report?: WorkflowReviewReport;
      },
      actor: {
        agentId: string | null;
        userId: string | null;
        runId: string | null;
      },
    ) {
      return workflowTransaction(db, async (context) => {
        const { tx } = context;
        await tx
          .select({ id: issues.id })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
          .for("update");
        const [run] = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.issueId, issueId),
              eq(workflowRuns.companyId, companyId),
            ),
          )
          .for("update");
        if (!run) throw notFound("Workflow not found");
        const node = run.snapshot.definition.nodes.find(
          (item) => item.id === input.nodeId,
        );
        const state = run.nodes[input.nodeId];
        if (
          run.status !== "running" ||
          run.version !== input.expectedVersion ||
          !node ||
          !["review", "approval"].includes(node.kind) ||
          state.status !== "running" ||
          state.attempt !== input.attempt ||
          !state.issueId
        )
          throw conflict("Workflow stage changed; reload before deciding");
        const [attempt] = await tx
          .select({ status: workflowNodeAttempts.status })
          .from(workflowNodeAttempts)
          .where(
            and(
              eq(workflowNodeAttempts.runId, run.id),
              eq(workflowNodeAttempts.nodeId, node.id),
              eq(workflowNodeAttempts.attempt, state.attempt),
            ),
          );
        if (attempt?.status !== "running")
          throw conflict("This attempt already has a recorded verdict");
        if (
          (state.agentId && actor.agentId !== state.agentId) ||
          (state.userId && actor.userId !== state.userId) ||
          (node.kind === "approval" && actor.agentId)
        )
          throw forbidden("Only the current workflow participant may decide");
        if (actor.agentId) {
          if (!actor.runId) throw forbidden("An active node run is required");
          const [active] = await tx
            .select({
              issueId: heartbeatRuns.issueId,
              nativeIssueId: heartbeatRuns.nativeIssueId,
              contextSnapshot: heartbeatRuns.contextSnapshot,
            })
            .from(heartbeatRuns)
            .where(
              and(
                eq(heartbeatRuns.id, actor.runId),
                eq(heartbeatRuns.companyId, companyId),
                eq(heartbeatRuns.agentId, actor.agentId),
              ),
            );
          if (
            !active ||
            (active.nativeIssueId ??
              active.issueId ??
              active.contextSnapshot?.issueId) !== state.issueId
          )
            throw forbidden("Verdict must come from this node's run");
          await assertAgentRunWriteAllowed(tx as unknown as Db, companyId, {
            agentId: actor.agentId,
            runId: actor.runId,
          });
        }
        if (
          actor.agentId &&
          node.kind === "review" &&
          run.snapshot.definition.handoffVersion === 1 &&
          !input.report
        )
          throw unprocessable(
            "This workflow requires a structured review report with artifact revision, criteria and evidence",
          );
        const reportError = workflowReviewError(input.outcome, input.report);
        if (reportError) throw unprocessable(reportError);
        const feedback = workflowReviewFeedback(input.comment, input.report);
        state.status =
          input.outcome === "passed" && actor.agentId
            ? "running"
            : input.outcome;
        state.result = feedback;
        state.finishedAt =
          state.status === "running" ? null : new Date().toISOString();
        await context.updateIssue(state.issueId, {
          status: "done",
          companyGuard: companyId,
        });
        await tx
          .update(workflowNodeAttempts)
          .set({
            status: input.outcome,
            evidence: {
              comment: input.comment,
              ...(input.report ? { report: input.report } : {}),
              source: actor.agentId ? "agent_review" : "human_decision",
            },
            decisionAgentId: actor.agentId,
            decisionUserId: actor.userId,
            finishedAt: new Date(),
          })
          .where(
            and(
              eq(workflowNodeAttempts.runId, run.id),
              eq(workflowNodeAttempts.nodeId, node.id),
              eq(workflowNodeAttempts.attempt, state.attempt),
            ),
          );
        if (input.outcome === "failed")
          await repair(context, run, node.id, feedback);
        await save(tx, run);
        await signalDatabaseWork(tx, WORKFLOW_QUEUE);
        await tx
          .update(workflowRuns)
          .set({
            needsReconcile: ["running", "cancelled"].includes(run.status),
          })
          .where(eq(workflowRuns.id, run.id));
        await context.activity({
          companyId,
          actorType: actor.agentId ? "agent" : "user",
          actorId: actor.agentId ?? actor.userId!,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "workflow.node_decided",
          entityType: "issue",
          entityId: issueId,
          details: {
            workflowRunId: run.id,
            nodeId: node.id,
            attempt: input.attempt,
            outcome: input.outcome,
          },
        });
        return run;
      });
    },
    async control(
      companyId: string,
      issueId: string,
      input: {
        action: "pause" | "resume" | "cancel" | "retry";
        expectedVersion: number;
        reason: string;
      },
      userId: string,
    ) {
      const result = await workflowTransaction(db, async (context) => {
        const { tx } = context;
        await tx
          .select({ id: issues.id })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
          .for("update");
        const [run] = await tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.issueId, issueId),
              eq(workflowRuns.companyId, companyId),
            ),
          )
          .for("update");
        if (!run) throw notFound("Workflow not found");
        if (
          run.version !== input.expectedVersion ||
          ["succeeded", "cancelled"].includes(run.status)
        )
          throw conflict("Workflow changed or has finished");
        if (input.action === "pause" || input.action === "cancel") {
          run.status = input.action === "pause" ? "paused" : "cancelled";
          run.stopReason = input.reason;
          await holdWorkflow(tx, run, input.reason);
          await queueStops(tx, run);
          if (run.status === "cancelled") {
            run.finishedAt = new Date();
            await cancelNodes(context, run);
          }
        } else {
          if (!["paused", "waiting_human"].includes(run.status))
            throw conflict("Only stopped workflows may be resumed");
          if (
            run.startedAt &&
            run.deadlineAt.getTime() <= run.updatedAt.getTime()
          )
            throw conflict(
              "The immutable deadline is exhausted; create a new authorized task",
            );
          run.deadlineAt = new Date(
            run.deadlineAt.getTime() + Date.now() - run.updatedAt.getTime(),
          );
          if (run.pauseHoldId) {
            const treeControl = issueTreeControlService(tx as unknown as Db);
            const hold = await treeControl.getHold(
              run.companyId,
              run.pauseHoldId,
            );
            if (hold?.status === "active")
              await treeControl.releaseHold(
                companyId,
                issueId,
                run.pauseHoldId,
                {
                  actor: { actorType: "user", actorId: userId, userId },
                  reason: input.reason,
                },
              );
            run.pauseHoldId = null;
          }
          run.status = "running";
          run.stopReason = null;
          if (!(await resumeInterruptedNodes(context, run)))
            throw conflict(
              "The previous executor is still stopping; retry after it settles",
            );
          for (const [id, node] of Object.entries(run.nodes)) {
            if (
              node.status === "failed" ||
              (input.action === "retry" &&
                node.status === "running" &&
                !node.issueId)
            ) {
              if (node.attempt >= run.snapshot.limits.maxAttempts)
                throw conflict(
                  "The immutable retry ceiling is exhausted; create a new authorized task",
                );
              await repair(context, run, id, input.reason);
            }
          }
        }
        await context.updateIssue(issueId, {
          status:
            run.status === "cancelled"
              ? "cancelled"
              : run.status === "paused"
                ? "in_review"
                : "in_progress",
          companyGuard: companyId,
        });
        await save(tx, run);
        await signalDatabaseWork(tx, WORKFLOW_QUEUE);
        await tx
          .update(workflowRuns)
          .set({
            needsReconcile: ["running", "cancelled"].includes(run.status),
          })
          .where(eq(workflowRuns.id, run.id));
        await context.activity({
          companyId,
          actorType: "user",
          actorId: userId,
          action: `workflow.${input.action}`,
          entityType: "issue",
          entityId: issueId,
          details: { workflowRunId: run.id, reason: input.reason },
        });
        return run;
      });
      await drainStops(result.id);
      return result;
    },
  };
}
