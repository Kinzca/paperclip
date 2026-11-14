import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { hasWorkspaceRestoreFailure } from "@paperclipai/shared";
import { environmentLeases, heartbeatRunEvents, heartbeatRuns, nativeRunFinalizations, type Db } from "@paperclipai/db";
import { PROCESS_IDENTITY_RECORDED, PROCESS_START_REQUESTED } from "./native-local-process-stop.js";
import { hasRemoteTerminationReceipt } from "./remote-execution-termination.js";

type Run = typeof heartbeatRuns.$inferSelect;
type DispatchFields = "startedAt" | "runtimeModeResolvedAt" | "processPid" | "processGroupId" |
  "processStartedAt" | "nativeIssueId" | "nativeSessionId" | "sessionIdAfter" |
  "controllerBootId" | "controllerLeaseExpiresAt" | "executionStage" | "contextSnapshot" |
  "scheduledRetryAt" | "scheduledRetryAttempt" | "scheduledRetryReason" | "retryOfRunId" | "finishedAt";

/** The queued-run gate owns this receipt before execution authority is claimed.
 * A deliberate review, connection response or dependency wait has no provider actions to reconcile. The error code
 * alone is not proof; missing or conflicting dispatch evidence retains the hold. */
export function isPreDispatchReviewWait(
  run: Pick<Run, "runtimeMode" | "status" | "errorCode" | "resultJson"> & Partial<Pick<Run, DispatchFields>>,
): boolean {
  const dependencyWait = run.errorCode === "issue_dependencies_blocked" &&
    run.finishedAt != null && run.scheduledRetryAt != null &&
    typeof run.retryOfRunId === "string" && (run.scheduledRetryAttempt ?? 0) > 0 &&
    run.scheduledRetryReason === "transient_failure" &&
    run.contextSnapshot?.wakeReason === "transient_failure_retry" &&
    run.contextSnapshot?.retryOfRunId === run.retryOfRunId &&
    (run.resultJson === null ||
      (run.resultJson?.stopReason === run.errorCode &&
        run.resultJson?.timeoutSource === "scheduled_retry_gate" &&
        run.resultJson?.providerWorkStarted === false));
  const finalResponseWait = run.errorCode === "issue_waiting_for_response" &&
    (run.resultJson?.preDispatchResponseWait as { version?: number; providerWorkStarted?: boolean } | undefined)?.version === 1 &&
    (run.resultJson?.preDispatchResponseWait as { providerWorkStarted?: boolean } | undefined)?.providerWorkStarted === false;
  return run.runtimeMode === "legacy" && run.status === "cancelled" &&
    (dependencyWait || ((run.errorCode === "issue_continuation_waiting_on_review" ||
      (run.errorCode === "issue_waiting_for_response" &&
        run.contextSnapshot?.connectionIntentResolution === "existing_connection" &&
        run.contextSnapshot?.source === "connection_intent.resolved" &&
        run.contextSnapshot?.interactionKind === "connection_intent" &&
        run.contextSnapshot?.interactionStatus === "expired" &&
        run.contextSnapshot?.mutation === "interaction" &&
        typeof run.contextSnapshot?.interactionId === "string")) &&
    run.resultJson?.stopReason === run.errorCode &&
    run.resultJson?.timeoutSource === "stale_queued_run_gate")) &&
    !hasWorkspaceRestoreFailure(run.resultJson) &&
    (finalResponseWait || (run.startedAt === null && run.runtimeModeResolvedAt === null)) &&
    run.processPid === null && run.processGroupId === null && run.processStartedAt === null &&
    run.nativeIssueId === null && run.nativeSessionId === null && run.sessionIdAfter === null &&
    (finalResponseWait || (run.controllerBootId === null && run.controllerLeaseExpiresAt === null && run.executionStage === null));
}

/** The row receipt is a candidate, not permission to discard conflicting
 * retained execution or cleanup evidence. Historical false holds must be
 * checked against the same evidence that gates explicit user admission. */
export async function isPreDispatchReviewWaitVerified(db: Db, run: Run): Promise<boolean> {
  if (!isPreDispatchReviewWait(run)) return false;
  // Older scheduled-retry cancellations omitted resultJson. Require the gate's
  // original durable event as well as absence of all execution evidence.
  if (run.errorCode === "issue_dependencies_blocked" && run.resultJson === null) {
    const [suppression] = await db.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(
      eq(heartbeatRunEvents.companyId, run.companyId), eq(heartbeatRunEvents.runId, run.id),
      eq(heartbeatRunEvents.eventType, "lifecycle"),
      eq(heartbeatRunEvents.message, "Scheduled retry suppressed because issue dependencies are still blocked"),
      sql`${heartbeatRunEvents.payload}->>'issueId' = ${run.contextSnapshot?.issueId}`,
      sql`${heartbeatRunEvents.payload}->>'scheduledRetryAt' = ${new Date(run.scheduledRetryAt!).toISOString()}`,
      sql`${heartbeatRunEvents.payload}->>'scheduledRetryAttempt' = ${String(run.scheduledRetryAttempt)}`,
      sql`${heartbeatRunEvents.payload}->>'scheduledRetryReason' = 'transient_failure'`,
    )).limit(1);
    if (!suppression) return false;
  }
  const [coordinator] = await db.select({ id: nativeRunFinalizations.runId }).from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.companyId, run.companyId), eq(nativeRunFinalizations.runId, run.id),
  )).limit(1);
  if (coordinator) return false;
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, run.companyId), eq(environmentLeases.heartbeatRunId, run.id),
  ));
  if (leases.some(lease => lease.provider === "local"
    ? !lease.releasedAt || lease.status === "pending_cleanup" || lease.cleanupStatus === "failed"
    : !hasRemoteTerminationReceipt(lease))) return false;
  const [execution] = await db.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(
    eq(heartbeatRunEvents.companyId, run.companyId), eq(heartbeatRunEvents.runId, run.id),
    or(isNotNull(heartbeatRunEvents.sourceEventId),
      inArray(heartbeatRunEvents.eventType, ["adapter.invoke", PROCESS_START_REQUESTED, PROCESS_IDENTITY_RECORDED,
        "harness.ready", "session.started", "session.resumed", "session.updated", "turn.started",
        "provider.event", "provider.rpc_result", "tool.execution.started"])),
  )).limit(1);
  return !execution;
}
