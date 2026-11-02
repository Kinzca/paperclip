import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, or, desc, sql } from "drizzle-orm";
import {
  executionWorkspaces,
  heartbeatRuns,
  issueAttachments,
  issueWorkProducts,
  type Db,
} from "@paperclipai/db";
import type { WorkflowCheck } from "@paperclipai/shared";
import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";
import { instanceSettingsService } from "../instance-settings.js";
import { readWorkflowPlatform } from "./admission.js";
import { redactSensitiveText } from "../../redaction.js";
import {
  runningProcesses,
  signalRunningProcess,
} from "@paperclipai/adapter-utils/server-utils";

export interface WorkflowCheckResult {
  passed: boolean;
  summary: string;
  evidence: Record<string, unknown>;
  retryable: boolean;
}

/** All checks operate on server-owned records and the delivered task workspace.
 * No command, environment, path or pass flag is accepted from an agent result. */
export async function runWorkflowCheck(
  db: Db,
  input: {
    companyId: string;
    attemptId: string;
    issueId: string;
    executionWorkspaceId: string | null;
    check: WorkflowCheck;
    remainingSeconds: number;
    signal?: AbortSignal;
  },
): Promise<WorkflowCheckResult> {
  if (input.signal?.aborted || input.remainingSeconds <= 0)
    return {
      passed: false,
      summary: "Verification was interrupted or its deadline expired",
      evidence: {},
      retryable: false,
    };
  if (input.check.kind === "evidence") {
    const [attachments, products, runs] = await Promise.all([
      db
        .select({ id: issueAttachments.id })
        .from(issueAttachments)
        .where(
          and(
            eq(issueAttachments.companyId, input.companyId),
            eq(issueAttachments.issueId, input.issueId),
          ),
        ),
      db
        .select({ id: issueWorkProducts.id })
        .from(issueWorkProducts)
        .where(
          and(
            eq(issueWorkProducts.companyId, input.companyId),
            eq(issueWorkProducts.issueId, input.issueId),
            inArray(issueWorkProducts.status, [
              "active",
              "ready_for_review",
              "approved",
            ]),
          ),
        ),
      db
        .select({
          id: heartbeatRuns.id,
          status: heartbeatRuns.status,
          exitCode: heartbeatRuns.exitCode,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, input.companyId),
            or(
              eq(heartbeatRuns.issueId, input.issueId),
              eq(heartbeatRuns.nativeIssueId, input.issueId),
              sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${input.issueId}`,
            ),
          ),
        )
        .orderBy(desc(heartbeatRuns.createdAt))
        .limit(1),
    ]);
    const missing = input.check.required.filter((kind) =>
      kind === "attachment"
        ? !attachments.length
        : kind === "work_product"
          ? !products.length
          : runs[0]?.status !== "succeeded",
    );
    return {
      passed: !missing.length,
      summary: missing.length
        ? `Missing required evidence: ${missing.join(", ")}`
        : "Required evidence is retained. A run receipt alone does not establish test correctness.",
      evidence: {
        attachmentIds: attachments.map((item) => item.id),
        workProductIds: products.map((item) => item.id),
        runIds: runs.map((item) => item.id),
        missing,
      },
      retryable: true,
    };
  }
  const [platform, general] = await Promise.all([
    readWorkflowPlatform(db),
    instanceSettingsService(db).getGeneral(),
  ]);
  if (!platform.allowHostCommands || general.executionMode !== "any")
    return {
      passed: false,
      summary:
        "Host command checks are not enabled by the operator, or this instance requires managed execution.",
      evidence: {},
      retryable: false,
    };
  const [workspace] = input.executionWorkspaceId
    ? await db
        .select()
        .from(executionWorkspaces)
        .where(
          and(
            eq(executionWorkspaces.id, input.executionWorkspaceId),
            eq(executionWorkspaces.companyId, input.companyId),
          ),
        )
    : [];
  if (
    !workspace?.cwd ||
    workspace.providerType !== "local_fs" ||
    workspace.status !== "active"
  )
    return {
      passed: false,
      summary:
        "A command check requires an active local execution workspace. No host fallback is permitted.",
      evidence: {},
      retryable: false,
    };
  const cwd = await fs.realpath(workspace.cwd);
  if (!path.isAbsolute(cwd))
    throw new Error(
      "Workflow workspace did not resolve to an absolute directory",
    );
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  const stop = () => {
    const process = runningProcesses.get(input.attemptId);
    if (process) signalRunningProcess(process, "SIGKILL");
  };
  input.signal?.addEventListener("abort", stop, { once: true });
  const result = await runAdapterExecutionTargetProcess(
    input.attemptId,
    { kind: "local" },
    input.check.command,
    input.check.args,
    {
      cwd,
      env,
      inheritEnv: false,
      timeoutSec: Math.max(
        1,
        Math.min(input.check.timeoutSeconds, input.remainingSeconds),
      ),
      graceSec: 5,
      onLog: async () => {},
      onSpawn: async () => {
        if (input.signal?.aborted) queueMicrotask(stop);
      },
    },
  ).finally(() => input.signal?.removeEventListener("abort", stop));
  const passed = result.exitCode === 0 && !result.timedOut && !result.signal;
  return {
    passed,
    summary: passed
      ? "Configured verification command passed"
      : `Verification command failed (exit ${result.exitCode}, timeout ${result.timedOut})`,
    retryable: input.check.retrySafe,
    evidence: {
      command: input.check.command,
      args: input.check.args,
      workspaceId: workspace.id,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      stdout: redactSensitiveText(result.stdout.slice(-32000)),
      stderr: redactSensitiveText(result.stderr.slice(-32000)),
    },
  };
}
