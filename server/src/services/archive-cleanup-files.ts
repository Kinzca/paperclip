import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { archiveCleanupJobs, assets, executionWorkspaces, heartbeatRuns, issueAttachments, issues,
  projectWorkspaces, workspaceOperations, workspaceRuntimeServices, type Db } from "@paperclipai/db";
import type { ArchivedChatCleanupFile, ArchivedChatCleanupPlan } from "@paperclipai/shared";
import { loadConfig, type Config } from "../config.js";
import { conflict, notFound } from "../errors.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import type { StorageService } from "../storage/types.js";
import { measureStorageUsage } from "./storage-usage.js";

const execFileAsync = promisify(execFile);

function logRoot() {
  return path.resolve(process.env.RUN_LOG_BASE_PATH ?? path.join(resolvePaperclipInstanceRoot(), "data", "run-logs"));
}

/** Metadata only; do not follow links inside a registered storage root. */
export async function inspectCleanupFile(root: string, filename: string) {
  const base = path.resolve(root);
  const target = path.resolve(filename);
  if (!target.startsWith(base + path.sep)) throw conflict("File is outside its registered storage root.");
  try {
    const canonicalBase = await realpath(base);
    if (await realpath(target) !== path.join(canonicalBase, path.relative(base, target))) throw conflict("Linked files are retained.");
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw conflict("Only regular owned files can be removed.");
    return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function workspaceSafety(db: Db, companyId: string, issueId: string, workspaceId: string) {
  const [workspace] = await db.select().from(executionWorkspaces)
    .where(and(eq(executionWorkspaces.id, workspaceId), eq(executionWorkspaces.companyId, companyId)));
  if (!workspace || workspace.providerType !== "git_worktree" || workspace.metadata?.createdByRuntime !== true
    || !["archived", "cleanup_failed"].includes(workspace.status)
    || (workspace.sourceIssueId && workspace.sourceIssueId !== issueId)) return null;
  const directory = workspace.providerRef ?? workspace.cwd;
  if (!directory || !path.isAbsolute(directory) || directory === path.parse(directory).root || directory === os.homedir()) return null;
  const [linked] = await db.select({ id: issues.id }).from(issues)
    .where(and(eq(issues.executionWorkspaceId, workspaceId), ne(issues.id, issueId))).limit(1);
  const [runtime] = await db.select({ id: workspaceRuntimeServices.id }).from(workspaceRuntimeServices)
    .where(and(eq(workspaceRuntimeServices.executionWorkspaceId, workspaceId),
      sql`${workspaceRuntimeServices.status} NOT IN ('stopped', 'failed', 'exited')`)).limit(1);
  const [activeRun] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), sql`${heartbeatRuns.status} IN ('queued', 'running')`,
    sql`${heartbeatRuns.contextSnapshot}->>'executionWorkspaceId' = ${workspaceId}`)).limit(1);
  if (linked || runtime || activeRun) return null;
  const registered = await db.select({ id: projectWorkspaces.id, cwd: projectWorkspaces.cwd }).from(projectWorkspaces);
  const others = await db.select({ cwd: executionWorkspaces.cwd, providerRef: executionWorkspaces.providerRef })
    .from(executionWorkspaces).where(ne(executionWorkspaces.id, workspaceId));
  const target = path.resolve(directory);
  const overlaps = (other: string | null) => other && (path.resolve(other) === target
    || path.resolve(other).startsWith(target + path.sep) || target.startsWith(path.resolve(other) + path.sep));
  if (registered.some((row) => overlaps(row.cwd)) || others.some((row) => overlaps(row.cwd) || overlaps(row.providerRef))) return null;
  const { executionWorkspaceService } = await import("./execution-workspaces.js");
  const readiness = await executionWorkspaceService(db).getCloseReadiness(workspaceId);
  if (!readiness || readiness.isSharedWorkspace || readiness.isProjectPrimaryWorkspace || !readiness.git?.repoRoot
    || readiness.git.hasDirtyTrackedFiles || readiness.git.hasUntrackedFiles
    || readiness.git.isMergedIntoBase !== true) return null;
  const ignored = await execFileAsync("git", ["-C", directory, "ls-files", "--others", "--ignored", "--exclude-standard"], { maxBuffer: 256_000, timeout: 5_000 });
  if (ignored.stdout.trim()) return null;
  const repository = registered.find((root) => root.id === workspace.projectWorkspaceId)?.cwd;
  if (!repository || path.resolve(repository) === target) return null;
  const common = await execFileAsync("git", ["-C", directory, "rev-parse", "--git-common-dir"], { timeout: 5_000 });
  const sourceCommon = await execFileAsync("git", ["-C", repository, "rev-parse", "--git-common-dir"], { timeout: 5_000 });
  if (await realpath(path.resolve(directory, common.stdout.trim())) !== await realpath(path.resolve(repository, sourceCommon.stdout.trim()))) return null;
  return { workspace, directory, repoRoot: repository };
}

export async function buildArchiveCleanupPlan(db: Db, companyId: string, issueId: string, config: Config = loadConfig()): Promise<ArchivedChatCleanupPlan> {
  const files: ArchivedChatCleanupFile[] = [];
  const retained: ArchivedChatCleanupPlan["retained"] = [];
  const attachments = await db.select({ provider: assets.provider, objectKey: assets.objectKey })
    .from(issueAttachments).innerJoin(assets, eq(assets.id, issueAttachments.assetId))
    .where(and(eq(issueAttachments.companyId, companyId), eq(issueAttachments.issueId, issueId)));
  for (const attachment of attachments) {
    const target = attachment.provider === "local_disk" ? path.resolve(config.storageLocalDiskBaseDir, attachment.objectKey) : attachment.objectKey;
    try {
      if (attachment.provider !== config.storageProvider || !attachment.objectKey.startsWith(companyId + "/")) throw conflict("Storage provider or file ownership requires review.");
      const identity = attachment.provider === "local_disk" ? await inspectCleanupFile(config.storageLocalDiskBaseDir, target) : undefined;
      files.push({ kind: "attachment", path: target, provider: attachment.provider, objectKey: attachment.objectKey,
        bytes: identity?.size ?? 0, identity: identity ?? undefined, status: "pending" });
    } catch (error) { retained.push({ path: target, reason: error instanceof Error ? error.message : "File ownership could not be verified." }); }
  }
  const runs = await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, logRef: heartbeatRuns.logRef, status: heartbeatRuns.status,
    logStore: heartbeatRuns.logStore, nativeIssueId: heartbeatRuns.nativeIssueId }).from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.issueId, issueId))).limit(501);
  for (const run of runs.slice(0, 500)) {
    if (!run.logRef) continue;
    const target = path.resolve(logRoot(), run.logRef);
    if (!["succeeded", "failed", "cancelled", "timed_out"].includes(run.status) || run.logStore !== "local_file"
      || run.logRef !== path.join(companyId, run.agentId, run.id + ".ndjson") || (run.nativeIssueId && run.nativeIssueId !== issueId)) {
      retained.push({ path: run.logRef, reason: "Run-log ownership or terminal state requires review." }); continue;
    }
    const [shared] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.logRef, run.logRef), ne(heartbeatRuns.id, run.id))).limit(1);
    const [operation] = await db.select({ id: workspaceOperations.id }).from(workspaceOperations).where(eq(workspaceOperations.logRef, run.logRef)).limit(1);
    if (shared || operation) { retained.push({ path: target, reason: "Shared files are retained." }); continue; }
    try {
      const identity = await inspectCleanupFile(logRoot(), target);
      files.push({ kind: "run_log", path: target, runId: run.id, bytes: identity?.size ?? 0, identity: identity ?? undefined, status: "pending" });
    } catch (error) { retained.push({ path: target, reason: error instanceof Error ? error.message : "File ownership could not be verified." }); }
  }
  if (runs.length > 500) retained.push({ path: "run-logs", reason: "Only the first 500 run logs were inventoried; other files are retained." });
  const [task] = await db.select({ projectId: issues.projectId, executionWorkspaceId: issues.executionWorkspaceId }).from(issues).where(eq(issues.id, issueId));
  const workspaces = await db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.companyId, companyId),
    or(eq(executionWorkspaces.sourceIssueId, issueId), task?.executionWorkspaceId ? eq(executionWorkspaces.id, task.executionWorkspaceId) : undefined)));
  for (const workspace of workspaces) {
    const directory = workspace.providerRef ?? workspace.cwd;
    if (!directory) continue;
    try {
      if (!(await workspaceSafety(db, companyId, issueId, workspace.id)) || await realpath(directory) !== path.resolve(directory)) throw conflict("Workspace is shared, unverified, active or contains unpreserved work; retained.");
      const usage = await measureStorageUsage([{ path: directory, category: "workspaces" }], directory, { maxEntries: 30_000, maxMs: 2_000 });
      if (!usage.complete) throw conflict("Workspace inventory is incomplete; retained.");
      const { readExecutionWorkspaceLifecycleGeneration } = await import("./execution-workspaces.js");
      files.push({ kind: "workspace", path: directory, workspaceId: workspace.id,
        generation: readExecutionWorkspaceLifecycleGeneration(workspace.metadata), bytes: usage.totalBytes, status: "pending" });
    } catch (error) { retained.push({ path: directory, reason: error instanceof Error ? error.message : "Workspace ownership requires review." }); }
  }
  if (task?.projectId) {
    const roots = await db.select({ cwd: projectWorkspaces.cwd }).from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.companyId, companyId), eq(projectWorkspaces.projectId, task.projectId)));
    for (const root of roots) if (root.cwd) retained.push({ path: root.cwd, reason: "Project source, shared assets and deliverables are retained." });
  }
  return { files, retained, localBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

/** Job row lock serializes retries; the manifest is committed with task deletion. */
export async function executeArchiveCleanupJob(db: Db, storage: StorageService, companyId: string, userId: string, jobId: string) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(archiveCleanupJobs).where(and(eq(archiveCleanupJobs.id, jobId),
      eq(archiveCleanupJobs.companyId, companyId), eq(archiveCleanupJobs.userId, userId))).for("update");
    if (!job) throw notFound("Cleanup job not found");
    const [task] = await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, job.issueId));
    if (task) throw conflict("Task deletion has not completed; files are retained.");
    const config = loadConfig();
    let removedBytes = job.removedBytes;
    const files = job.files.map((file) => ({ ...file }));
    for (const file of files) {
      if (file.status === "removed") continue;
      try {
        if (file.kind === "workspace") {
          const [current] = await tx.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, file.workspaceId!), eq(executionWorkspaces.companyId, companyId)));
          const { readExecutionWorkspaceLifecycleGeneration } = await import("./execution-workspaces.js");
          if (!current || !["archived", "cleanup_failed"].includes(current.status)
            || (current.providerRef ?? current.cwd) !== file.path || readExecutionWorkspaceLifecycleGeneration(current.metadata) !== file.generation) throw conflict("Workspace changed; retained.");
          const present = await lstat(file.path).then(() => true, (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false; throw error;
          });
          if (!present) { file.status = "removed"; delete file.error; continue; }
          if (await realpath(file.path) !== path.resolve(file.path)) throw conflict("Linked files are retained.");
          const safe = await workspaceSafety(tx as unknown as Db, companyId, job.issueId, file.workspaceId!);
          if (!safe || safe.directory !== file.path) throw conflict("Workspace changed or is no longer safe to remove.");
          const { executionWorkspaceService } = await import("./execution-workspaces.js");
          const fenced = await executionWorkspaceService(tx as unknown as Db).fenceClosedWorkspaceDestruction({
            workspaceId: file.workspaceId!, capturedGeneration: file.generation!, destroy: async () => {
              if (!(await workspaceSafety(tx as unknown as Db, companyId, job.issueId, file.workspaceId!))) throw conflict("Workspace changed; retained.");
              // Git performs its own final dirty-worktree check; never force, run hooks or remove branch refs.
              await execFileAsync("git", ["-C", safe.repoRoot, "worktree", "remove", "--", file.path], { timeout: 15_000 });
              return { cleaned: true };
            } });
          if (fenced.skippedReopened || !fenced.result.cleaned) throw conflict("Workspace cleanup was skipped or incomplete.");
        } else {
          if (file.kind === "attachment" && (file.provider !== storage.provider || !file.objectKey?.startsWith(companyId + "/"))) throw conflict("Storage provider or file ownership changed.");
          if (file.kind === "attachment") {
            const [newOwner] = await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.companyId, companyId), eq(assets.objectKey, file.objectKey!))).limit(1);
            if (newOwner) throw conflict("Shared files are retained.");
          }
          if (file.kind === "run_log") {
            const [shared] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.logRef, path.relative(logRoot(), file.path)), ne(heartbeatRuns.id, file.runId!))).limit(1);
            const [operation] = await tx.select({ id: workspaceOperations.id }).from(workspaceOperations).where(eq(workspaceOperations.logRef, path.relative(logRoot(), file.path))).limit(1);
            if (shared || operation) throw conflict("Shared files are retained.");
            const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, file.runId!), eq(heartbeatRuns.companyId, companyId)));
            if (!run || !["succeeded", "failed", "cancelled", "timed_out"].includes(run.status)
              || run.logRef !== path.join(companyId, run.agentId, run.id + ".ndjson")
              || file.path !== path.join(logRoot(), run.logRef) || (run.issueId && run.issueId !== job.issueId)) throw conflict("Run-log ownership changed; retained.");
          }
          if (file.kind === "run_log" || file.provider === "local_disk") {
            const identity = await inspectCleanupFile(file.kind === "run_log" ? logRoot() : config.storageLocalDiskBaseDir, file.path);
            if (identity) {
              if (!file.identity || Object.entries(identity).some(([key, value]) => value !== file.identity![key as keyof typeof identity])) throw conflict("File changed since confirmation; retained.");
              await unlink(file.path);
            }
          } else await storage.deleteObject(companyId, file.objectKey!);
          if (file.kind === "run_log") await tx.update(heartbeatRuns).set({ logStore: null, logRef: null, logBytes: null }).where(eq(heartbeatRuns.id, file.runId!));
        }
        file.status = "removed"; delete file.error; removedBytes += file.bytes;
      } catch (error) { file.status = "failed"; file.error = error instanceof Error ? error.message : "File cleanup failed."; }
    }
    await tx.update(archiveCleanupJobs).set({ files, removedBytes,
      status: files.every((file) => file.status === "removed") ? "completed" : "pending", updatedAt: new Date() }).where(eq(archiveCleanupJobs.id, jobId));
    return { id: job.id, title: job.title, files, removedBytes };
  });
}
