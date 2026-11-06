import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { clock, DEFAULT_BACKGROUND_POLICY, hash, isBusinessRoot, normalizePolicy, selectSources } from "../src/wiki/background-policy.js";
const core = vi.hoisted(() => ({
  captureWikiSource: vi.fn(), getDistillationAutoApplyRestriction: vi.fn(), getEventIngestionSettings: vi.fn(),
  getPaperclipIngestionProfile: vi.fn(), listPages: vi.fn(), resolveWikiAgentResource: vi.fn(),
  resolveWikiProjectResource: vi.fn(), spaceFolderStatus: vi.fn(),
  updateEventIngestionSettings: vi.fn(), updatePaperclipIngestionProfile: vi.fn(),
}));
vi.mock("../src/wiki/core.js", () => core);
import { completeBackgroundBatch, configureBackground, observeBackgroundEvent, processBackgroundCompany, readBackgroundBatch } from "../src/wiki/background.js";
const CID = "11111111-1111-4111-8111-111111111111";
const PID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-06T08:00:00Z");
const TEXT = "已确认的项目约定：像素风暴的唯一主目录为 /Users/xzq/Developer/voxel-storm/。验收结果：路径关联核对通过，临时调试文件按需放入项目 work/ 目录，代码与知识库资料分开存放。";
beforeEach(() => vi.resetAllMocks());
function fixture() {
  const policy = { ...DEFAULT_BACKGROUND_POLICY, enabled: true, projectIds: [PID], enabledAt: "2026-11-01T00:00:00Z" };
  const root = { id: "root-1", companyId: CID, projectId: PID, parentId: null, status: "done",
    identifier: "GAME-1", title: "完成项目目录约定", description: "", originKind: null,
    completedAt: "2026-11-06T07:40:00Z", updatedAt: "2026-11-06T07:40:00Z" } as unknown as Issue;
  const state = {
    policy, runtime: { maintenanceDay: "2026-11-06" } as Record<string, any>, version: 0,
    extraRoots: [] as Issue[],
    pending: [{ root_issue_id: root.id, source_hash: null, processed_hash: null,
      attempts: 0, observed_at: root.updatedAt, due_at: root.updatedAt, status: "pending" }] as any[],
    busy: false, lease: true, created: [] as Issue[], comments: [{ id: "c1", body: TEXT }],
    hashes: {} as Record<string, string>, files: { "raw/.gitkeep": "", "wiki/index.md": "# Index" } as Record<string, string>,
  };
  core.getDistillationAutoApplyRestriction.mockReturnValue({ autoApplyAllowed: true });
  core.getEventIngestionSettings.mockResolvedValue({ enabled: true });
  core.getPaperclipIngestionProfile.mockResolvedValue({ effectiveState: "enabled", profile: {
    enabled: true, sourceScopes: [{ kind: "selected_projects", projectIds: [PID] }],
    sourceKinds: { issues: true, comments: true, documents: true } } });
  core.spaceFolderStatus.mockResolvedValue({ folder: { healthy: true } });
  core.resolveWikiAgentResource.mockResolvedValue({ agent: { id: "wiki-agent", status: "idle" } });
  core.resolveWikiProjectResource.mockResolvedValue({ projectId: "wiki-project" });
  core.listPages.mockImplementation(async () => ({ pages: Object.entries(state.hashes).map(([path, contentHash]) => ({ path, contentHash })) }));
  core.captureWikiSource.mockImplementation(async (_ctx, input) => { state.files[input.rawPath] = input.contents; return { status: "ok" }; });
  const query = vi.fn(async (sql: string, params: any[]) => {
    if (sql.includes("SELECT policy")) return params[0] === CID ? [{ policy: structuredClone(state.policy), runtime: structuredClone(state.runtime), version: state.version }] : [];
    if (sql.includes("SELECT * FROM") && sql.includes("wiki_background_roots")) return structuredClone(state.pending.filter(p => p.status === "pending" && Date.parse(p.due_at) <= Date.parse(params[1])));
    if (sql.includes("SELECT root_issue_id FROM")) return state.pending.filter(p => p.processed_hash === params[1] && p.status === "processed").slice(0, 1);
    if (sql.includes("wiki_sources")) return [{ content_hash: hash(state.files[params[1]]) }];
    return [];
  });
  const execute = vi.fn(async (sql: string, params: any[]) => {
    if (sql.includes("SET lease_token=$2")) return { rowCount: state.lease ? 1 : 0 };
    if (sql.includes("SET runtime=$2")) {
      if (state.version !== params[2]) return { rowCount: 0 };
      state.runtime = JSON.parse(params[1]); state.version++;
    }
    const row = state.pending.find(p => p.root_issue_id === params[1]);
    if (sql.includes("SET source_hash=$3")) { row.source_hash = params[2]; row.attempts = 0; }
    if (sql.includes("SET processed_hash=$3")) { row.processed_hash = params[2]; row.status = Date.parse(row.observed_at) > Date.parse(params[3]) ? "pending" : "processed"; }
    if (sql.includes("SET status=$3,processed_hash=$4")) { row.status = params[2]; row.processed_hash = params[3]; }
    if (sql.includes("SET status='needs_review'")) row.status = "needs_review";
    if (sql.includes("SET attempts=attempts+1")) { row.attempts++; row.due_at = params[2]; row.status = row.attempts >= 2 ? "failed" : "pending"; }
    if (sql.includes("INSERT INTO") && sql.includes("wiki_background_roots") && row && Date.parse(params[2]) > Date.parse(row.observed_at)) {
      row.observed_at = params[2]; row.due_at = params[3]; row.status = "pending";
    }
    return { rowCount: 1 };
  });
  const create = vi.fn(async (input: any) => { const issue = { ...input, id: "background-" + state.created.length } as Issue; state.created.push(issue); return issue; });
  const ctx = {
    db: { namespace: "test_wiki", query, execute },
    issues: {
      list: vi.fn(async (input: any) => {
        if (input.originId) return state.created.filter(i => i.originId === input.originId);
        if (input.status === "done") return [root, ...state.extraRoots];
        if (input.status === "todo" && state.busy) return [{ id: "development", projectId: PID, status: "todo" }];
        return [];
      }),
      requestWakeup: vi.fn(async () => ({ issueId: "background-0", queued: true, runId: "run-1" })),
      create, get: vi.fn(async (id: string) => id === root.id ? root : state.extraRoots.find(i => i.id === id) ?? state.created.find(i => i.id === id) ?? null),
      getSubtree: vi.fn(async (id: string) => ({ issues: [id === root.id ? root : state.extraRoots.find(i => i.id === id)!] })), listComments: vi.fn(async () => state.comments),
      documents: { list: vi.fn(async () => []) },
    },
    projects: { get: vi.fn(async () => ({ companyId: CID })) },
    localFolders: {
      readText: vi.fn(async (_c, _f, path: string) => state.files[path]),
      list: vi.fn(async (_c, _f, opts: { relativePath: string }) => {
        const prefix = opts.relativePath + "/";
        const children = new Set(Object.keys(state.files).filter(p => p.startsWith(prefix)).map(p => prefix + p.slice(prefix.length).split("/")[0]));
        return { entries: [...children].map(path => ({ path })), truncated: false };
      }),
    }, logger: { error: vi.fn() },
  } as unknown as PluginContext;
  return { state, root, ctx, create, execute };
}
describe("source and policy boundaries", () => {
  it("accepts only completed business roots after activation", () => {
    const { root, state } = fixture(); expect(isBusinessRoot(root, state.policy)).toBe(true);
    for (const patch of [{ parentId: "parent" }, { status: "in_review" }, { originKind: "plugin:wiki:operation" }, { completedAt: "2026-10-01" }, { projectId: "other" }]) expect(isBusinessRoot({ ...root, ...patch }, state.policy)).toBe(false);
  });
  it("deduplicates source identities, timestamps, whitespace and repeated delivery text", () => {
    const a = selectSources([{ reference: "old", body: TEXT }], 24000);
    const b = selectSources([{ reference: "new", body: TEXT + "\nupdated_at: 2030-01-01" }, { reference: "duplicate", body: TEXT.replace(/ /g, "  ") }], 24000);
    expect(b.fingerprint).toBe(a.fingerprint); expect(b.pieces).toHaveLength(1);
  });
  it("rejects acknowledgements and exposes truncation", () => {
    expect(selectSources([{ reference: "status", body: "收到，完成。" }], 24000).meaningful).toBe(false);
    expect(selectSources([{ reference: "large", body: TEXT.repeat(50) }], 1000).clipped).toBe(true);
  });
  it("uses China time and validates unknown policy input", () => {
    expect(clock(new Date("2026-11-06T19:00:00Z"), "Asia/Shanghai")).toEqual({ day: "2026-11-07", hour: 3 });
    for (const bad of [{ enabled: "yes" }, { waitForBusinessIdle: "false" }, { timezone: 123 }, { quietMinutes: -1 }, { projectIds: ["bad"] }, { enabledAt: "fake" }]) expect(() => normalizePolicy(bad, DEFAULT_BACKGROUND_POLICY, NOW)).toThrow();
  });
});
describe("pre-provider gates and durable completion", () => {
  it("configures the scoped profile once without resetting it through the legacy settings writer", async () => {
    const { ctx } = fixture();
    await configureBackground(ctx, CID, { enabled: true, projectIds: [PID] }, NOW);
    expect(core.updatePaperclipIngestionProfile).toHaveBeenCalledWith(ctx, expect.objectContaining({
      profile: expect.objectContaining({ enabled: true, sourceScopes: [{ kind: "selected_projects", projectIds: [PID] }] }),
    }));
    expect(core.updateEventIngestionSettings).not.toHaveBeenCalled();
  });
  it("wakes the assigned operation and recovers a persisted todo with the same admission key", async () => {
    const { ctx, create } = fixture();
    expect((await processBackgroundCompany(ctx, CID, NOW)).status).toBe("dispatched");
    const first = vi.mocked(ctx.issues.requestWakeup).mock.calls[0];
    expect(first[0]).toBe("background-0");
    expect(first[1]).toBe(CID);
    expect(first[2]?.idempotencyKey).toMatch(/^wiki:background:.*:wakeup$/);
    expect((await processBackgroundCompany(ctx, CID, NOW)).status).toBe("batch_active");
    expect(ctx.issues.requestWakeup).toHaveBeenLastCalledWith(...first);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("allocates no agent for an empty queue", async () => {
    const { state, root, ctx, create } = fixture(); state.pending = []; root.completedAt = new Date("2026-10-01");
    expect(await processBackgroundCompany(ctx, CID, NOW)).toMatchObject({ status: "no_delta", dispatched: 0 }); expect(create).not.toHaveBeenCalled();
  });
  it("gives development priority before capturing or delivering sources", async () => {
    const { state, ctx, create } = fixture(); state.busy = true;
    expect(await processBackgroundCompany(ctx, CID, NOW)).toEqual({ status: "development_first" });
    expect(core.captureWikiSource).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it("allows background learning alongside a content backlog when explicitly configured", async () => {
    const { state, ctx, create } = fixture(); state.busy = true; state.policy.waitForBusinessIdle = false;
    expect((await processBackgroundCompany(ctx, CID, NOW)).status).toBe("dispatched");
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("waits for the maintainer's current work even when company idleness is not required", async () => {
    const { state, ctx, create } = fixture(); state.policy.waitForBusinessIdle = false;
    core.resolveWikiAgentResource.mockResolvedValue({ agent: { id: "wiki-agent", status: "running" } });
    expect(await processBackgroundCompany(ctx, CID, NOW)).toEqual({ status: "maintainer_busy" });
    expect(create).not.toHaveBeenCalled();
  });
  it("does not invoke during the merge window or for low-value notes", async () => {
    const { state, ctx, create } = fixture(); state.pending[0].due_at = "2026-11-06T08:05:00Z";
    await processBackgroundCompany(ctx, CID, NOW); expect(create).not.toHaveBeenCalled();
    state.pending[0].due_at = "2026-11-06T07:50:00Z"; state.comments = [{ id: "a", body: "收到，完成。" }];
    await processBackgroundCompany(ctx, CID, NOW); expect(create).not.toHaveBeenCalled(); expect(state.pending[0].status).toBe("no_value");
  });
  it("does not queue children or self operations", async () => {
    const { root, ctx, execute } = fixture();
    for (const patch of [{ parentId: "parent" }, { originKind: "plugin:wiki:background" }]) {
      Object.assign(root, patch);
      await observeBackgroundEvent(ctx, { companyId: CID, entityId: root.id, occurredAt: NOW.toISOString(), eventId: "event" } as PluginEvent);
    }
    expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
  });
  it("suppresses concurrent checks, exhausted quotas and cross-company access", async () => {
    const { state, ctx, create } = fixture(); state.lease = false;
    expect(await processBackgroundCompany(ctx, CID, NOW)).toEqual({ status: "already_checking" });
    state.lease = true; state.runtime.day = "2026-11-06"; state.runtime.runs = 6;
    expect(await processBackgroundCompany(ctx, CID, NOW)).toEqual({ status: "daily_limit" });
    expect(await processBackgroundCompany(ctx, "other", NOW)).toEqual({ status: "disabled" });
    await expect(readBackgroundBatch(ctx, "other", "batch")).rejects.toThrow(); expect(create).not.toHaveBeenCalled();
  });
  it("dispatches separately, validates actual writes, and never repeats an unchanged source", async () => {
    const { state, root, ctx, create } = fixture();
    expect((await processBackgroundCompany(ctx, CID, NOW)).status).toBe("dispatched");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ priority: "low", surfaceVisibility: "plugin_operation" });
    expect(create.mock.calls[0][0].parentId).toBeUndefined(); expect(root.status).toBe("done");
    const batch = state.runtime.active;
    await expect(completeBackgroundBatch(ctx, { companyId: CID, batchId: batch.id, outcome: "changed", pages: ["wiki/projects/game/index.md"], summary: "Claiming an update without changing a real file must be rejected." })).rejects.toThrow("real changed");
    state.hashes["wiki/projects/game/index.md"] = "new";
    state.files["wiki/projects/game/index.md"] = "Verified delivery source " + batch.roots[0].rawPath;
    await completeBackgroundBatch(ctx, { companyId: CID, batchId: batch.id, outcome: "changed", pages: ["wiki/projects/game/index.md"], summary: "Merged verified delivery into the existing project page with provenance." });
    state.created[0].status = "done";
    await processBackgroundCompany(ctx, CID, NOW); expect(state.pending[0].status).toBe("processed");
    state.comments.push({ id: "duplicate", body: TEXT });
    await observeBackgroundEvent(ctx, { companyId: CID, entityId: root.id, occurredAt: "2026-11-06T08:01:00Z", eventId: "replayed" } as PluginEvent);
    await processBackgroundCompany(ctx, CID, new Date("2026-11-06T08:07:00Z"));
    expect(create).toHaveBeenCalledTimes(1); expect(core.captureWikiSource).toHaveBeenCalledTimes(1);
  });
  it("skips identical useful content already processed in another root", async () => {
    const { state, ctx, create } = fixture();
    state.pending.push({ ...state.pending[0], root_issue_id: "older-root", status: "processed",
      processed_hash: selectSources([{ reference: "old", body: TEXT }], 24000).fingerprint });
    await processBackgroundCompany(ctx, CID, NOW);
    expect(create).not.toHaveBeenCalled();
    expect(state.pending[0].status).toBe("processed");
  });
  it("does not advance a source cursor without a validated receipt", async () => {
    const { state, ctx, create } = fixture();
    await processBackgroundCompany(ctx, CID, NOW); state.created[0].status = "done";
    await processBackgroundCompany(ctx, CID, NOW);
    expect(state.pending[0].processed_hash).toBeNull(); expect(state.pending[0].attempts).toBe(1); expect(create).toHaveBeenCalledTimes(1);
  });
  it("recovers the existing origin identity without duplicating a task", async () => {
    const { state, ctx, create } = fixture();
    await processBackgroundCompany(ctx, CID, NOW); delete state.runtime.active.issueId;
    expect(await processBackgroundCompany(ctx, CID, NOW)).toEqual({ status: "batch_active" }); expect(create).toHaveBeenCalledTimes(1);
  });
  it("flags oversized sources without advancing or invoking a provider", async () => {
    const { state, ctx, create } = fixture(); state.comments[0].body = TEXT.repeat(300);
    await processBackgroundCompany(ctx, CID, NOW);
    expect(state.pending[0].status).toBe("needs_review"); expect(state.pending[0].processed_hash).toBeNull(); expect(create).not.toHaveBeenCalled();
  });
  it("coalesces completed roots into one bounded background task", async () => {
    const { state, root, ctx, create } = fixture();
    const second = { ...root, id: "root-2", identifier: "GAME-2" };
    state.extraRoots.push(second);
    state.pending.push({ ...state.pending[0], root_issue_id: second.id });
    expect(await processBackgroundCompany(ctx, CID, NOW)).toMatchObject({ status: "dispatched", roots: 2 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(state.runtime.active.roots).toHaveLength(2);
  });
  it("does not wake an agent for unchanged nightly maintenance", async () => {
    const { state, root, ctx, create } = fixture();
    state.pending = []; root.completedAt = new Date("2026-10-01");
    state.runtime.maintenanceHash = hash("[]");
    expect(await processBackgroundCompany(ctx, CID, new Date("2026-11-06T19:00:00Z"))).toMatchObject({ status: "no_delta" });
    expect(state.runtime.maintenanceDay).toBe("2026-11-07");
    expect(create).not.toHaveBeenCalled();
  });
  it("honors a scope reduction in the existing ingestion settings", async () => {
    const { ctx, create } = fixture();
    core.getPaperclipIngestionProfile.mockResolvedValue({ effectiveState: "enabled", profile: {
      sourceScopes: [{ kind: "selected_projects", projectIds: ["other-project"] }], sourceKinds: {} } });
    expect(await processBackgroundCompany(ctx, CID, NOW)).toEqual({ status: "disabled" });
    expect(create).not.toHaveBeenCalled();
  });
  it("waits when a root was marked done before its children finished", async () => {
    const { root, ctx, create } = fixture();
    vi.mocked(ctx.issues.getSubtree).mockResolvedValue({ issues: [root, { ...root, id: "child", parentId: root.id, status: "in_progress" }] } as any);
    await processBackgroundCompany(ctx, CID, NOW);
    expect(create).not.toHaveBeenCalled();
  });
  it("preserves the public-deployment auto-apply restriction", async () => {
    const { ctx } = fixture(); core.getDistillationAutoApplyRestriction.mockReturnValue({ autoApplyAllowed: false });
    await expect(configureBackground(ctx, CID, { enabled: true }, NOW)).rejects.toThrow("public deployment");
  });
});
