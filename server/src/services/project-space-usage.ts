import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { assets, executionWorkspaces, heartbeatRuns, issueAttachments, issues, projects, projectWorkspaces, type Db } from "@paperclipai/db";
import type { ProjectSpaceUsage } from "@paperclipai/shared";

type RootUsage = ProjectSpaceUsage["projects"][number]["roots"][number];
type DirectoryUsage = RootUsage["directories"][number];
type RegisteredRoot = { projectId: string; companyId: string; cwd: string | null };
const within = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);
const overlaps = (a: string, b: string) => within(a, b) || within(b, a);

/** Names classify display only; no inferred name ever grants deletion access. */
export async function scanProjectDirectory(
  rootPath: string, shared: boolean, active: boolean,
  limits = { maxEntries: 30_000, maxMs: 2_000 },
): Promise<RootUsage> {
  const result: RootUsage = { path: rootPath, shared, status: "measured", bytes: 0, directories: [] };
  if (!path.isAbsolute(rootPath) || rootPath === path.parse(rootPath).root || rootPath === os.homedir()) {
    return { ...result, status: "unavailable" };
  }
  try {
    // Refuse linked roots/ancestors rather than scanning an unregistered target.
    if (await realpath(rootPath) !== path.resolve(rootPath) || !(await lstat(rootPath)).isDirectory()) {
      return { ...result, status: "unavailable" };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...result, status: "missing" };
    if (code === "EACCES" || code === "EPERM") return { ...result, status: "unavailable" };
    throw error;
  }
  const groups = new Map<string, DirectoryUsage>();
  const pending = [rootPath];
  const deadline = Date.now() + limits.maxMs;
  let entries = 0;
  while (pending.length) {
    if (entries >= limits.maxEntries || Date.now() >= deadline) { result.status = "partial"; break; }
    const current = pending.pop()!;
    entries++;
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) continue;
      const relative = path.relative(rootPath, current);
      const name = relative.split(path.sep)[0] || ".";
      if (relative && !groups.has(name)) {
        const normalized = name.toLowerCase();
        const kind: DirectoryUsage["kind"] = ["src", "source", "scripts", "scenes", "shaders", "assets", "art", "models", ".git", "config"].includes(normalized) ? "source"
          : ["outputs", "exports", "deliverables", "production", "docs", "renders"].includes(normalized) ? "deliverables"
          : ["build", "dist", "target", ".next"].includes(normalized) ? "build"
          : ["node_modules", ".venv", "vendor"].includes(normalized) ? "dependencies"
          : [".cache", "cache", ".godot", ".vite", ".pytest_cache"].includes(normalized) ? "cache"
          : ["tmp", "temp", ".tmp"].includes(normalized) ? "temporary" : "other";
        const review = ["build", "dependencies", "cache", "temporary"].includes(kind);
        groups.set(name, { path: path.join(rootPath, name), name, kind, bytes: 0, complete: false,
          protection: shared || active || !review ? "protected" : "rebuildable",
          reason: shared ? "Shared or overlapping registered directory; never clean from one project."
            : active ? "Project has unfinished or paused work; retain its files."
            : review ? "Name-based classification only. Rebuildability and references need review; not approved for deletion."
            : "Source, original assets, deliverables or unclassified files are protected." });
      }
      if (stat.isDirectory()) {
        const directory = await opendir(current);
        for await (const entry of directory) {
          if (entries + pending.length >= limits.maxEntries || Date.now() >= deadline) { result.status = "partial"; break; }
          if (!entry.isSymbolicLink()) pending.push(path.join(current, entry.name));
        }
      } else if (stat.isFile()) {
        const group = groups.get(name);
        if (group) group.bytes += stat.size;
        result.bytes += stat.size;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") { result.status = "partial"; continue; }
      if (code === "EACCES" || code === "EPERM") { result.status = "partial"; continue; }
      throw error;
    }
  }
  result.directories = [...groups.values()].map((group) => ({ ...group, complete: result.status === "measured" }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return result;
}

/** No file writes or cleanup operations are exposed by this inventory. */
export async function companyProjectSpaceUsage(db: Db, companyId: string, readCondition: SQL, options: { expanded?: boolean } = {}): Promise<ProjectSpaceUsage> {
  const [projectRows, workspaceRows, executionRows, activityRows, attachments, logs] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, pausedAt: projects.pausedAt }).from(projects)
      .where(and(eq(projects.companyId, companyId), readCondition)).orderBy(projects.name),
    db.select({ projectId: projectWorkspaces.projectId, companyId: projectWorkspaces.companyId, cwd: projectWorkspaces.cwd })
      .from(projectWorkspaces).where(and(isNotNull(projectWorkspaces.cwd), sql`${projectWorkspaces.sourceType} IN ('local_path', 'non_git_path', 'git_repo')`)),
    db.select({ projectId: executionWorkspaces.projectId, companyId: executionWorkspaces.companyId, cwd: executionWorkspaces.cwd, status: executionWorkspaces.status })
      .from(executionWorkspaces).where(and(isNotNull(executionWorkspaces.cwd), eq(executionWorkspaces.providerType, "local_fs"), sql`${executionWorkspaces.status} <> 'deleted'`)),
    db.selectDistinct({ projectId: issues.projectId }).from(issues).where(and(eq(issues.companyId, companyId), sql`(
      ${issues.status} NOT IN ('done', 'cancelled')
      OR EXISTS (SELECT 1 FROM workflow_runs flow WHERE flow.company_id = ${companyId}
        AND flow.issue_id = ${issues.id} AND flow.status NOT IN ('succeeded', 'failed', 'cancelled'))
      OR EXISTS (SELECT 1 FROM heartbeat_runs run WHERE run.company_id = ${companyId}
        AND run.issue_id = ${issues.id} AND run.status IN ('queued', 'running'))
    )`)),
    db.select({ projectId: issues.projectId, bytes: sql<number>`COALESCE(sum(${assets.byteSize}), 0)::float8` })
      .from(assets).leftJoin(issueAttachments, and(eq(assets.id, issueAttachments.assetId), eq(issueAttachments.companyId, companyId)))
      .leftJoin(issues, and(eq(issues.id, issueAttachments.issueId), eq(issues.companyId, companyId)))
      .where(and(eq(assets.companyId, companyId), eq(assets.provider, "local_disk"))).groupBy(issues.projectId),
    db.select({ projectId: issues.projectId, bytes: sql<number>`COALESCE(sum(${heartbeatRuns.logBytes}), 0)::float8` })
      .from(heartbeatRuns).leftJoin(issues, and(eq(issues.id, heartbeatRuns.issueId), eq(issues.companyId, companyId)))
      .where(eq(heartbeatRuns.companyId, companyId)).groupBy(issues.projectId),
  ]);
  const registered: RegisteredRoot[] = [...workspaceRows, ...executionRows]
    .filter((row) => row.cwd && path.isAbsolute(row.cwd)).map((row) => ({ ...row, cwd: path.resolve(row.cwd!) }));
  const result: ProjectSpaceUsage = { companyId, measuredAt: new Date().toISOString(), previewOnly: true,
    complete: true, exclusiveBytes: 0, sharedBytes: 0, projects: [],
    unattributedRegisteredAttachmentBytes: attachments.filter((row) => !projectRows.some((project) => project.id === row.projectId)).reduce((sum, row) => sum + row.bytes, 0),
    unattributedRegisteredLogBytes: logs.filter((row) => !projectRows.some((project) => project.id === row.projectId)).reduce((sum, row) => sum + row.bytes, 0),
  };
  const deadline = Date.now() + (options.expanded ? 20_000 : 6_000);
  const sharedCounted: RootUsage[] = [];
  for (const project of projectRows) {
    const roots = [...new Set(registered.filter((row) => row.companyId === companyId && row.projectId === project.id).map((row) => row.cwd!))].sort((a, b) => a.length - b.length);
    const activeOrPaused = !!project.pausedAt || activityRows.some((row) => row.projectId === project.id)
      || executionRows.some((row) => row.companyId === companyId && row.projectId === project.id && !["archived", "closed", "deleted"].includes(row.status));
    const entry: ProjectSpaceUsage["projects"][number] = { id: project.id, name: project.name, activeOrPaused,
      exclusiveBytes: 0, sharedBytes: 0, roots: [],
      registeredAttachmentBytes: attachments.find((row) => row.projectId === project.id)?.bytes ?? 0,
      registeredLogBytes: logs.find((row) => row.projectId === project.id)?.bytes ?? 0 };
    for (const rootPath of roots) {
      const shared = registered.some((row) => (row.companyId !== companyId || row.projectId !== project.id) && overlaps(rootPath, row.cwd!));
      const covered = entry.roots.some((root) => within(rootPath, root.path));
      const usage = covered ? { path: rootPath, shared, bytes: 0, directories: [], status: "covered" as const }
        : Date.now() >= deadline ? { path: rootPath, shared, bytes: 0, directories: [], status: "partial" as const }
        : await scanProjectDirectory(rootPath, shared, activeOrPaused, { maxEntries: options.expanded ? 300_000 : 30_000,
          maxMs: Math.max(0, Math.min(options.expanded ? 6_000 : 2_000, deadline - Date.now())) });
      entry.roots.push(usage);
      if (!["measured", "covered"].includes(usage.status)) result.complete = false;
      if (!covered) {
        if (shared) { entry.sharedBytes += usage.bytes; sharedCounted.push(usage); }
        else entry.exclusiveBytes += usage.bytes;
      }
    }
    result.exclusiveBytes += entry.exclusiveBytes;
    result.projects.push(entry);
  }
  // Cross-project overlapping totals are a separate union, never added into
  // each project's exclusive total or counted repeatedly in the company total.
  result.sharedBytes = sharedCounted.filter((root, i, all) => !all.some((other, j) =>
    j !== i && within(root.path, other.path) && (root.path !== other.path || j < i))).reduce((sum, root) => sum + root.bytes, 0);
  return result;
}
