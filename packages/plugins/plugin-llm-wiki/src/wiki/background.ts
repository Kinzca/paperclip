import { randomUUID } from "node:crypto";
import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import {
  captureWikiSource, getDistillationAutoApplyRestriction, getEventIngestionSettings, getPaperclipIngestionProfile,
  listPages, resolveWikiAgentResource, resolveWikiProjectResource,
  spaceFolderStatus, updatePaperclipIngestionProfile,
} from "./core.js";
import {
  BACKGROUND_JOB_KEY, DEFAULT_BACKGROUND_POLICY, clock, hash, isBusinessRoot,
  normalizePolicy, selectSources, type BackgroundPolicy, type SourcePiece, type SourceCursor,
} from "./background-policy.js";

const ORIGIN = "plugin:paperclipai.plugin-llm-wiki:operation:background";
const FOLDER = "wiki-root";
type RootInput = { rootId: string; fingerprint: string; rawPath: string; title: string;
  window?: { next: SourceCursor; complete: boolean } };
type Batch = {
  id: string; timezone: string; kind: "distill" | "maintenance"; originId: string; issueId?: string;
  startedAt: string; roots: RootInput[]; before: Record<string, string | null>;
  maintenanceHash?: string;
  receipt?: { outcome: "changed" | "no_change"; pages: string[]; summary: string };
};
type Runtime = {
  active?: Batch | null; day?: string; runs?: number; scanOffsets?: Record<string, number>;
  maintenanceDay?: string; maintenanceHash?: string;
  sourceWindows?: Record<string, SourceCursor>;
  lastOutcome?: Record<string, unknown>;
};
type CompanyRow = { policy: BackgroundPolicy; runtime: Runtime; version: number };
type RootRow = {
  root_issue_id: string; source_hash: string | null; processed_hash: string | null;
  status: string; attempts: number; observed_at: string; due_at: string;
};
function table(ctx: PluginContext, name: string) {
  return ctx.db.namespace + ".wiki_background_" + name;
}
function iso(value: unknown) { return new Date(String(value)).toISOString(); }
async function company(ctx: PluginContext, companyId: string): Promise<CompanyRow | null> {
  return (await ctx.db.query<CompanyRow>("SELECT policy, runtime, version FROM " + table(ctx, "companies") + " WHERE company_id=$1", [companyId]))[0] ?? null;
}
async function runtimeUpdate(ctx: PluginContext, companyId: string, fn: (runtime: Runtime) => Runtime) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await company(ctx, companyId);
    if (!row) throw new Error("Background policy is not configured");
    const next = fn(structuredClone(row.runtime));
    const result = await ctx.db.execute("UPDATE " + table(ctx, "companies") +
      " SET runtime=$2::jsonb, version=version+1, updated_at=now() WHERE company_id=$1 AND version=$3",
      [companyId, JSON.stringify(next), row.version]);
    if (result.rowCount === 1) return next;
  }
  throw new Error("Concurrent background state update; retry the next scheduled check");
}
async function pageHashes(ctx: PluginContext, companyId: string) {
  const pages = await listPages(ctx, { companyId, wikiId: "default", spaceSlug: "default", limit: 1000 });
  return Object.fromEntries(pages.pages.map(p => [p.path, p.contentHash]));
}
function knowledgeHash(pages: Record<string, string | null>) {
  return hash(JSON.stringify(Object.entries(pages).filter(([p]) => p !== "wiki/index.md" && p !== "wiki/log.md").sort()));
}
export async function configureBackground(ctx: PluginContext, companyId: string, input: unknown, now = new Date()) {
  const old = await company(ctx, companyId);
  const policy = normalizePolicy(input, old?.policy ?? DEFAULT_BACKGROUND_POLICY, now);
  if (policy.enabled && !getDistillationAutoApplyRestriction().autoApplyAllowed) {
    throw new Error("Background auto-apply is unavailable in an authenticated public deployment");
  }
  for (const projectId of policy.projectIds) {
    const project = await ctx.projects.get(projectId, companyId);
    if (!project || project.companyId !== companyId) throw new Error("Selected project is not in this company");
    if (project.managedByPlugin) throw new Error("Select business projects, not plugin-managed projects");
  }
  const folder = await spaceFolderStatus(ctx, { companyId, wikiId: "default", spaceSlug: "default" });
  if (policy.enabled && !folder.folder.healthy) throw new Error("Configure a healthy default Wiki folder before enabling background processing");
  const managed = await resolveWikiAgentResource(ctx, companyId);
  if (policy.enabled && (!managed.agent || ["paused", "terminated", "pending_approval"].includes(managed.agent.status))) {
    throw new Error("Activate the Wiki Maintainer before enabling background processing");
  }
  const runtime: Runtime = old?.runtime ?? {
    maintenanceDay: clock(now, policy.timezone).day,
    maintenanceHash: knowledgeHash(await pageHashes(ctx, companyId)),
  };
  await ctx.db.execute("INSERT INTO " + table(ctx, "companies") +
    " (company_id,policy,runtime) VALUES ($1,$2::jsonb,$3::jsonb) ON CONFLICT (company_id) DO UPDATE SET policy=EXCLUDED.policy, version=" +
    table(ctx, "companies").split(".").pop() + ".version+1, updated_at=now()",
    [companyId, JSON.stringify(policy), JSON.stringify(runtime)]);
  const currentProfile = await getPaperclipIngestionProfile(ctx, { companyId, wikiId: "default", spaceSlug: "default" });
  await updatePaperclipIngestionProfile(ctx, {
    companyId, wikiId: "default", spaceSlug: "default",
    profile: { ...currentProfile.profile, enabled: policy.enabled,
      sourceScopes: [{ kind: "selected_projects", projectIds: policy.projectIds }],
      sourceKinds: { issues: true, comments: true, documents: true, attachments: "metadata_only", workProducts: "metadata_only" },
    },
  });
  return backgroundStatus(ctx, companyId);
}
export async function backgroundStatus(ctx: PluginContext, companyId: string) {
  const row = await company(ctx, companyId);
  const counts = row ? await ctx.db.query<{ status: string; count: string }>(
    "SELECT status,count(*)::text AS count FROM " + table(ctx, "roots") + " WHERE company_id=$1 GROUP BY status", [companyId]) : [];
  const blockedRoots = row ? await ctx.db.query<{ root_issue_id: string; last_error: string | null }>(
    "SELECT root_issue_id,last_error FROM " + table(ctx, "roots") +
    " WHERE company_id=$1 AND status='needs_review' ORDER BY due_at,root_issue_id LIMIT 25", [companyId]) : [];
  return { policy: row?.policy ?? DEFAULT_BACKGROUND_POLICY, runtime: row?.runtime ?? {}, queue: counts, blockedRoots,
    jobKey: BACKGROUND_JOB_KEY, schedule: "*/5 * * * *", modelCallGate: "completed-root + useful-delta + idle-development" };
}
export async function resumeBackgroundSources(ctx: PluginContext, companyId: string, rootIssueIds: string[]) {
  const result = await ctx.db.execute("UPDATE " + table(ctx, "roots") +
    " SET status='pending',due_at=now(),last_error=NULL,updated_at=now()" +
    " WHERE company_id=$1 AND root_issue_id IN (" + rootIssueIds.map((_, index) => "$" + (index + 2)).join(",") + ") AND status='needs_review'",
    [companyId, ...rootIssueIds]);
  return { requeued: result.rowCount };
}
async function activeScope(ctx: PluginContext, companyId: string, policy: BackgroundPolicy) {
  if (!policy.enabled || !getDistillationAutoApplyRestriction().autoApplyAllowed) return null;
  if (!(await getEventIngestionSettings(ctx, companyId)).enabled) return null;
  const current = await getPaperclipIngestionProfile(ctx, { companyId, wikiId: "default", spaceSlug: "default" });
  if (current.effectiveState !== "enabled") return null;
  const selected = new Set(current.profile.sourceScopes.flatMap(s => s.kind === "selected_projects" ? s.projectIds : []));
  const projectIds = policy.projectIds.filter(id => selected.has(id));
  return projectIds.length ? { policy: { ...policy, projectIds }, sourceKinds: current.profile.sourceKinds } : null;
}
async function observeRoot(ctx: PluginContext, companyId: string, issue: Issue, policy: BackgroundPolicy, at: string, eventId: string) {
  if (!isBusinessRoot(issue, policy)) return;
  const due = new Date(Date.parse(at) + policy.quietMinutes * 60000).toISOString();
  await ctx.db.execute("INSERT INTO " + table(ctx, "roots") +
    " (company_id,root_issue_id,observed_at,due_at,event_id) VALUES ($1,$2,$3,$4,$5)" +
    " ON CONFLICT (company_id,root_issue_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,due_at=EXCLUDED.due_at," +
    "event_id=EXCLUDED.event_id,status='pending',updated_at=now() WHERE EXCLUDED.observed_at>" +
    "wiki_background_roots.observed_at",
    [companyId, issue.id, at, due, eventId]);
}
/** Returns true when this company uses the gated pipeline, including ignored child/self events. */
export async function observeBackgroundEvent(ctx: PluginContext, event: PluginEvent) {
  const row = await company(ctx, event.companyId);
  if (!row?.policy.enabled) return false;
  const scope = await activeScope(ctx, event.companyId, row.policy);
  if (!scope) return true;
  const issue = event.entityId ? await ctx.issues.get(event.entityId, event.companyId) : null;
  if (issue) await observeRoot(ctx, event.companyId, issue, scope.policy, event.occurredAt, event.eventId);
  return true;
}
async function developmentBusy(ctx: PluginContext, companyId: string, wikiProjectId: string) {
  for (const status of ["todo", "in_progress"] as const) {
    for (let offset = 0; offset < 1000; offset += 100) {
      const rows = await ctx.issues.list({ companyId, status, includePluginOperations: false, limit: 100, offset });
      if (rows.some(i => i.projectId !== wikiProjectId && !i.originKind?.startsWith("plugin:") &&
        !i.conversationAgentId)) return true;
      if (rows.length < 100) break;
      if (offset === 900) return true; // conservative bounded scan
    }
  }
  return false;
}
async function collectRoot(ctx: PluginContext, companyId: string, issue: Issue, maxCharacters: number,
  kinds: { issues: boolean; comments: boolean; documents: boolean }, cursor?: SourceCursor) {
  const tree = await ctx.issues.getSubtree(issue.id, companyId, { includeRoot: true });
  if (tree.issues.some(i => !["done", "cancelled"].includes(i.status))) return { waiting: true as const };
  if (tree.issues.length > 50) return { oversized: true as const };
  const pieces: SourcePiece[] = [];
  for (const child of tree.issues.filter(i => i.status === "done").sort((a, b) => a.id.localeCompare(b.id))) {
    if (kinds.issues && child.description) pieces.push({ reference: child.identifier + " task description", body: child.description });
    const comments = kinds.comments ? await ctx.issues.listComments(child.id, companyId) : [];
    for (const comment of comments) pieces.push({ reference: child.identifier + " comment " + comment.id, body: comment.body });
    const documents = kinds.documents ? await ctx.issues.documents.list(child.id, companyId) : [];
    for (const summary of documents.slice(0, 25)) {
      const document = await ctx.issues.documents.get(child.id, summary.key, companyId);
      if (document) pieces.push({ reference: child.identifier + " document " + summary.key, body: document.body });
    }
    if (documents.length > 25) return { oversized: true as const };
  }
  const selected = selectSources(pieces, maxCharacters, cursor);
  return { ...selected, waiting: false as const };
}
async function failBatch(ctx: PluginContext, companyId: string, batch: Batch, reason: string, now: Date) {
  for (const root of batch.roots) {
    await ctx.db.execute("UPDATE " + table(ctx, "roots") +
      " SET attempts=attempts+1,status=CASE WHEN attempts+1>=2 THEN 'failed' ELSE 'pending' END," +
      "due_at=$3,last_error=$4,updated_at=now() WHERE company_id=$1 AND root_issue_id=$2",
      [companyId, root.rootId, new Date(now.getTime() + 30 * 60000).toISOString(), reason]);
  }
  await runtimeUpdate(ctx, companyId, r => ({ ...r, active: null,
    lastOutcome: { status: "failed", batchId: batch.id, issueId: batch.issueId, reason, at: now.toISOString() },
    ...(batch.kind === "maintenance" ? { maintenanceDay: clock(now, batch.timezone).day } : {}),
  }));
}
async function requestBatchWakeup(ctx: PluginContext, companyId: string, batch: Batch, issueId: string) {
  await ctx.issues.requestWakeup(issueId, companyId, {
    reason: "wiki_background_batch",
    contextSource: "plugin.llm-wiki.background",
    idempotencyKey: batch.originId + ":wakeup",
  });
}
async function settleBatch(ctx: PluginContext, companyId: string, batch: Batch, now: Date) {
  let issue = batch.issueId ? await ctx.issues.get(batch.issueId, companyId) : null;
  if (!issue) issue = (await ctx.issues.list({ companyId, originKind: ORIGIN, originId: batch.originId, includePluginOperations: true, limit: 1 }))[0] ?? null;
  if (issue?.status === "done" && batch.receipt) {
    for (const root of batch.roots) await ctx.db.execute("UPDATE " + table(ctx, "roots") +
      " SET processed_hash=CASE WHEN $5 THEN $3 ELSE processed_hash END," +
      "status=CASE WHEN observed_at>$4::timestamptz OR NOT $5 THEN 'pending' ELSE 'processed' END," +
      "attempts=0,last_error=NULL,updated_at=now() WHERE company_id=$1 AND root_issue_id=$2",
      [companyId, root.rootId, root.fingerprint, batch.startedAt, !root.window || root.window.complete]);
    await runtimeUpdate(ctx, companyId, r => {
      const sourceWindows = { ...r.sourceWindows };
      for (const root of batch.roots) {
        if (root.window && !root.window.complete) sourceWindows[root.rootId] = root.window.next;
        else delete sourceWindows[root.rootId];
      }
      return { ...r, active: null, sourceWindows,
        ...(batch.kind === "maintenance" ? { maintenanceDay: clock(now, batch.timezone).day, maintenanceHash: batch.maintenanceHash } : {}),
        lastOutcome: { status: "processed", batchId: batch.id, issueId: issue!.id, receipt: batch.receipt, at: now.toISOString() },
      };
    });
    return true;
  }
  if (issue && ["blocked", "cancelled"].includes(issue.status)) {
    await failBatch(ctx, companyId, batch, "Maintenance task " + issue.status, now); return true;
  }
  if (issue?.status === "done" && !batch.receipt) {
    await failBatch(ctx, companyId, batch, "Task ended without a validated background receipt", now); return true;
  }
  // A running/queued provider is never duplicated after restart or lease expiry.
  if (issue) {
    if (issue.status === "todo") await requestBatchWakeup(ctx, companyId, batch, issue.id);
    return false;
  }
  if (now.getTime() - Date.parse(batch.startedAt) > 15 * 60000) {
    await failBatch(ctx, companyId, batch, "Dispatch requires inspection; no matching issue found", now); return true;
  }
  return false;
}
function batchPrompt(batch: Batch) {
  return [
    "Background Wiki batch " + batch.id + " (" + batch.kind + "). Business roots are already done; do not modify or reopen them.",
    "wikiId=default; spaceSlug=default. Use the managed wiki-tools.py helper and the existing authorized Paperclip plugin tool endpoint.",
    "First call wiki_background_batch with companyId and batchId to verify the active batch and read source paths.",
    "Read AGENTS.md and the installed wiki maintenance/distill skills, then existing project/concept pages and the immutable raw sources.",
    "Merge useful confirmed knowledge into EXISTING topic/project pages. Deduplicate semantically against existing pages. Do not create one page per task or dump status logs.",
    "A large root may span multiple source windows. Process only the supplied raw files; preserve partial-context uncertainty and do not claim the remaining windows have been ingested.",
    "Use .md Wiki links and sourceRefs; cite the raw source path. Keep verified facts distinct from unverified assertions; flag contradictions rather than silently changing accepted decisions.",
    "Update relevant project standup/index, Wiki index and log only when needed. Never modify raw sources or business code; no subtask delegation, external publishing or approval-policy changes.",
    "For mechanical maintenance, repair broken index/links; flag ambiguous semantic conflicts for the responsible specialist, do not invent answers.",
    "Finish with wiki_background_complete arguments {companyId, batchId, outcome: changed|no_change, pages: [actual changed content page paths], summary: concrete 20-2000 character summary}. The field is pages, not changedPagePaths; exclude wiki/index.md and wiki/log.md from pages. A no_change result uses pages: [] and needs a reason; changed needs a real content change with this batch's provenance.",
    "Only after the receipt is accepted, post a concise result and mark this BACKGROUND operation task done.",
  ].join("\n");
}
async function launchBatch(ctx: PluginContext, companyId: string, batch: Batch, agentId: string, projectId: string) {
  // Stored origin identity lets restart recovery find a task created immediately before a crash.
  const found = await ctx.issues.list({ companyId, originKind: ORIGIN, originId: batch.originId, includePluginOperations: true, limit: 1 });
  const issue = found[0] ?? await ctx.issues.create({
    companyId, projectId, title: batch.kind === "distill" ? "后台知识整理：已完成总任务合并批次" : "知识库增量维护",
    description: batchPrompt(batch), status: "todo", priority: "low", assigneeAgentId: agentId,
    assigneeAdapterOverrides: { adapterConfig: { timeoutSec: 600 } },
    billingCode: "plugin-llm-wiki:background", surfaceVisibility: "plugin_operation",
    originKind: ORIGIN, originId: batch.originId,
  });
  await runtimeUpdate(ctx, companyId, r => {
    if (r.active?.id !== batch.id) throw new Error("Background batch ownership changed");
    return { ...r, active: { ...r.active, issueId: issue.id } };
  });
  await requestBatchWakeup(ctx, companyId, batch, issue.id);
}

export async function processBackgroundCompany(ctx: PluginContext, companyId: string, now = new Date()) {
  const initial = await company(ctx, companyId);
  if (!initial) return { status: "disabled" };
  const token = randomUUID();
  const claim = await ctx.db.execute("UPDATE " + table(ctx, "companies") +
    " SET lease_token=$2,lease_until=$3 WHERE company_id=$1 AND (lease_until IS NULL OR lease_until<$4)",
    [companyId, token, new Date(now.getTime() + 15 * 60000).toISOString(), now.toISOString()]);
  if (claim.rowCount !== 1) return { status: "already_checking" };
  try {
    let row = (await company(ctx, companyId))!;
    if (row.runtime.active) {
      if (!await settleBatch(ctx, companyId, row.runtime.active, now)) return { status: "batch_active" };
      row = (await company(ctx, companyId))!;
    }
    const scope = await activeScope(ctx, companyId, row.policy);
    if (!scope) return { status: "disabled" };
    const policy = scope.policy;
    const folder = await spaceFolderStatus(ctx, { companyId, wikiId: "default", spaceSlug: "default" });
    if (!folder.folder.healthy) return { status: "wiki_unhealthy" };
    const agent = (await resolveWikiAgentResource(ctx, companyId)).agent;
    const project = await resolveWikiProjectResource(ctx, companyId);
    if (!agent || !project.projectId || ["paused", "terminated", "pending_approval", "error"].includes(agent.status)) {
      return { status: "maintainer_unavailable" };
    }
    if (policy.waitForBusinessIdle !== false && await developmentBusy(ctx, companyId, project.projectId)) return { status: "development_first" };
    if (agent.status === "running") return { status: "maintainer_busy" };
    const local = clock(now, policy.timezone);
    const runtime = row.runtime;
    const runs = runtime.day === local.day ? runtime.runs ?? 0 : 0;
    if (runs >= policy.maxRunsPerDay) return { status: "daily_limit" };

    // Bounded, restart-safe catch-up: rotate through completed roots; no provider calls.
    const scanOffsets = { ...runtime.scanOffsets };
    for (const projectId of policy.projectIds) {
      const roots = await ctx.issues.list({ companyId, projectId, status: "done", includePluginOperations: false, limit: 100, offset: scanOffsets[projectId] ?? 0 });
      for (const root of roots) await observeRoot(ctx, companyId, root, policy, iso(root.updatedAt), "catch-up:" + iso(root.updatedAt));
      scanOffsets[projectId] = roots.length === 100 ? (scanOffsets[projectId] ?? 0) + 100 : 0;
    }
    await runtimeUpdate(ctx, companyId, r => ({ ...r, scanOffsets }));

    const pending = await ctx.db.query<RootRow>("SELECT * FROM " + table(ctx, "roots") +
      " WHERE company_id=$1 AND status='pending' AND due_at<=$2 ORDER BY due_at,root_issue_id LIMIT 25",
      [companyId, now.toISOString()]);
    const inputs: RootInput[] = [];
    let characters = 0;
    for (const queued of pending) {
      const root = await ctx.issues.get(queued.root_issue_id, companyId);
      if (!root || !isBusinessRoot(root, policy)) {
        await ctx.db.execute("UPDATE " + table(ctx, "roots") + " SET status='ineligible' WHERE company_id=$1 AND root_issue_id=$2", [companyId, queued.root_issue_id]);
        continue;
      }
      const source = await collectRoot(ctx, companyId, root, policy.maxCharacters - 512, scope.sourceKinds,
        row.runtime.sourceWindows?.[root.id]);
      if ("waiting" in source && source.waiting) continue;
      if ("oversized" in source || ("pieces" in source && source.meaningful && !source.pieces.length)) {
        await ctx.db.execute("UPDATE " + table(ctx, "roots") +
          " SET status='needs_review',last_error='Source window exceeds configured bounds; no source cursor advanced' WHERE company_id=$1 AND root_issue_id=$2",
          [companyId, root.id]);
        continue;
      }
      if (!("fingerprint" in source)) continue;
      if (source.fingerprint !== queued.source_hash) {
        await ctx.db.execute("UPDATE " + table(ctx, "roots") +
          " SET source_hash=$3,attempts=0 WHERE company_id=$1 AND root_issue_id=$2",
          [companyId, root.id, source.fingerprint]);
      } else if (queued.attempts >= 2) continue;
      const alreadyProcessed = source.meaningful && (source.fingerprint === queued.processed_hash ||
        (await ctx.db.query<{ root_issue_id: string }>("SELECT root_issue_id FROM " + table(ctx, "roots") +
          " WHERE company_id=$1 AND processed_hash=$2 AND status='processed' LIMIT 1",
          [companyId, source.fingerprint])).length > 0);
      if (!source.meaningful || alreadyProcessed) {
        await ctx.db.execute("UPDATE " + table(ctx, "roots") +
          " SET status=$3,processed_hash=$4,last_error=NULL WHERE company_id=$1 AND root_issue_id=$2",
          [companyId, root.id, source.meaningful ? "processed" : "no_value", source.fingerprint]);
        continue;
      }
      const contents = "# Completed business root: " + root.identifier + " " + root.title +
        "\n\nSource task: " + root.identifier + "\nSource fingerprint: " + source.fingerprint +
        (source.clipped || source.window.start.piece || source.window.start.offset
          ? "\nPartial source window; remaining material is queued until its own receipt is accepted." : "") +
        "\n\n" + source.pieces.map(p => "## " + p.reference + "\n\n" + p.body).join("\n\n");
      if (characters + contents.length > policy.maxCharacters && inputs.length) break;
      const windowed = source.clipped || source.window.start.piece > 0 || source.window.start.offset > 0;
      const suffix = windowed ? "-window-" + source.window.next.version + "-" + source.window.start.piece + "-" + source.window.start.offset : "";
      const rawPath = "raw/background/" + root.id + "/" + source.fingerprint + suffix + ".md";
      let existingSource = true;
      let prefix = "raw";
      for (const part of ["background", root.id, source.fingerprint + suffix + ".md"]) {
        const listing = await ctx.localFolders.list(companyId, FOLDER, { relativePath: prefix, recursive: false, maxEntries: 10000 });
        const target = prefix + "/" + part;
        if (!listing.entries.some(entry => entry.path === target)) {
          if (listing.truncated) throw new Error("Cannot establish immutable source absence from a truncated listing");
          existingSource = false; break;
        }
        prefix = target;
      }
      if (existingSource) {
        const existing = await ctx.localFolders.readText(companyId, FOLDER, rawPath);
        const stored = await ctx.db.query<{ content_hash: string }>(
          "SELECT content_hash FROM " + ctx.db.namespace + ".wiki_sources WHERE company_id=$1 AND wiki_id='default' AND raw_path=$2",
          [companyId, rawPath]);
        if (stored[0] ? stored[0].content_hash !== hash(existing) ||
            !existing.includes("Source fingerprint: " + source.fingerprint) : existing !== contents) {
          throw new Error("Immutable background source content differs");
        }
      } else {
        await captureWikiSource(ctx, { companyId, wikiId: "default", spaceSlug: "default",
          rawPath, title: root.identifier + " completed delivery", contents, sourceType: "paperclip",
          metadata: { rootIssueId: root.id, sourceHash: source.fingerprint, background: true },
        });
      }
      inputs.push({ rootId: root.id, fingerprint: source.fingerprint, rawPath, title: root.title,
        ...(windowed ? { window: { next: source.window.next, complete: source.window.complete } } : {}) });
      characters += contents.length;
      if (inputs.length >= policy.maxRootsPerBatch) break;
    }
    if (!inputs.length && (local.hour < policy.maintenanceHour || runtime.maintenanceDay === local.day)) {
      return { status: "no_delta", dispatched: 0 };
    }
    const before = await pageHashes(ctx, companyId);
    let batch: Batch | null = null;
    const id = randomUUID();
    if (inputs.length) {
      batch = { id, timezone: policy.timezone, kind: "distill", originId: "wiki:background:" + id,
        startedAt: now.toISOString(), roots: inputs, before };
    } else if (local.hour >= policy.maintenanceHour && runtime.maintenanceDay !== local.day) {
      const fingerprint = knowledgeHash(before);
      if (runtime.maintenanceHash === fingerprint) {
        await runtimeUpdate(ctx, companyId, r => ({ ...r, maintenanceDay: local.day,
          lastOutcome: { status: "maintenance_unchanged", at: now.toISOString() } }));
      } else {
        batch = { id, timezone: policy.timezone, kind: "maintenance", originId: "wiki:background:" + id,
          startedAt: now.toISOString(), roots: [], before, maintenanceHash: fingerprint };
      }
    }
    if (!batch) return { status: "no_delta", dispatched: 0 };
    // Recheck immediately before allocating an agent; existing bounded batches are not preempted.
    if (policy.waitForBusinessIdle !== false && await developmentBusy(ctx, companyId, project.projectId)) return { status: "development_first" };
    await runtimeUpdate(ctx, companyId, r => ({ ...r, active: batch, day: local.day, runs: runs + 1 }));
    await launchBatch(ctx, companyId, batch, agent.id, project.projectId);
    return { status: "dispatched", batchId: batch.id, roots: inputs.length };
  } finally {
    await ctx.db.execute("UPDATE " + table(ctx, "companies") +
      " SET lease_token=NULL,lease_until=NULL WHERE company_id=$1 AND lease_token=$2", [companyId, token]);
  }
}
export async function tickBackground(ctx: PluginContext) {
  const rows = await ctx.db.query<{ company_id: string }>("SELECT company_id FROM " + table(ctx, "companies") +
    " WHERE policy->>'enabled'='true' OR runtime->'active' <> 'null'::jsonb");
  const outcomes = [];
  for (const row of rows) {
    try { outcomes.push({ companyId: row.company_id, ...await processBackgroundCompany(ctx, row.company_id) }); }
    catch (error) {
      const failure = { companyId: row.company_id, status: "error", error: String(error) };
      ctx.logger.error("Wiki background check failed", failure);
      outcomes.push(failure);
    }
  }
  return outcomes;
}
export async function readBackgroundBatch(ctx: PluginContext, companyId: string, batchId: string) {
  const batch = (await company(ctx, companyId))?.runtime.active;
  if (!batch || batch.id !== batchId) throw new Error("Background batch is not active for this company");
  return batch;
}
export async function completeBackgroundBatch(ctx: PluginContext, input: {
  companyId: string; batchId: string; outcome: "changed" | "no_change"; pages: string[]; summary: string;
}) {
  const batch = await readBackgroundBatch(ctx, input.companyId, input.batchId);
  if (batch.receipt) return { status: "receipt_already_saved" };
  const pages = input.pages;
  const after = await pageHashes(ctx, input.companyId);
  const changed = Object.keys(after).filter(p => p !== "wiki/index.md" && p !== "wiki/log.md" && after[p] !== batch.before[p]);
  if (input.outcome === "changed" && (!pages.length || pages.some(p => !changed.includes(p)))) {
    throw new Error("Changed receipt must name real changed content pages");
  }
  if (input.outcome === "no_change" && changed.length) throw new Error("Content changed; submit a changed receipt");
  if (input.outcome === "changed" && batch.roots.length) {
    let provenance = false;
    for (const page of pages) {
      const text = await ctx.localFolders.readText(input.companyId, FOLDER, page);
      if (batch.roots.some(root => text.includes(root.rawPath))) provenance = true;
    }
    if (!provenance) throw new Error("Changed knowledge must cite this batch's immutable raw source");
  }
  await runtimeUpdate(ctx, input.companyId, r => {
    if (r.active?.id !== batch.id) throw new Error("Background batch ownership changed");
    return { ...r, active: { ...r.active, receipt: {
      outcome: input.outcome, pages, summary: input.summary,
    } } };
  });
  return { status: "receipt_saved", batchId: batch.id };
}
export function registerBackgroundTools(ctx: PluginContext) {
  for (const name of ["wiki_background_batch", "wiki_background_complete"]) {
    ctx.tools.register(name, {
      displayName: name === "wiki_background_batch" ? "Read Background Batch" : "Complete Background Batch",
      description: "Operate on the current company-scoped background batch using existing Wiki permissions.",
      parametersSchema: ctx.manifest.tools?.find(t => t.name === name)?.parametersSchema ?? { type: "object" },
    }, async (params: unknown) => {
      if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Tool arguments must be an object");
      const value = params as Record<string, unknown>;
      if (typeof value.companyId !== "string" || typeof value.batchId !== "string") throw new Error("companyId and batchId are required");
      let result;
      if (name === "wiki_background_batch") result = await readBackgroundBatch(ctx, value.companyId, value.batchId);
      else {
        if (value.outcome !== "changed" && value.outcome !== "no_change") throw new Error("outcome must be changed or no_change");
        if (typeof value.summary !== "string" || value.summary.trim().length < 20 || value.summary.length > 2000) {
          throw new Error("Supply a concrete 20–2000 character summary");
        }
        if (!Array.isArray(value.pages) || !value.pages.every((p): p is string => typeof p === "string" &&
          /^wiki\/[a-zA-Z0-9_./-]+\.md$/.test(p) && !p.includes(".."))) throw new Error("Invalid knowledge page paths");
        result = await completeBackgroundBatch(ctx, { companyId: value.companyId, batchId: value.batchId,
          outcome: value.outcome, pages: value.pages, summary: value.summary });
      }
      return { content: JSON.stringify(result), data: result };
    });
  }
}
