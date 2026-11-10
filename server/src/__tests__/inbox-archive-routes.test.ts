import { execFileSync } from "node:child_process";
import { buildArchiveCleanupPlan, executeArchiveCleanupJob } from "../services/archive-cleanup-files.js";
import * as configModule from "../config.js";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  projects,
  projectWorkspaces,
  executionWorkspaces,
  archiveCleanupJobs,
  activityLog,
  assets,
  issueAttachments,
  issueRelations,
  issueReferenceMentions,
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issueComments,
  issueInboxArchives,
  issues,
  principalPermissionGrants,
  userInboxAgentPolicies,
} from "@paperclipai/db";
import { LOW_TRUST_REVIEW_PRESET } from "@paperclipai/shared";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { issueService } from "../services/issues.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("inbox archive routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-inbox-archive-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await db.delete(archiveCleanupJobs);
    await db.delete(issueAttachments);
    await db.delete(assets);
    await db.delete(issueRelations);
    await db.delete(issueReferenceMentions);
    await db.delete(issueComments);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(userInboxAgentPolicies);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function appFor(actor: Express.Request["actor"], storage = {} as never) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db, storage));
    app.use(errorHandler);
    return app;
  }

  async function seed(input: { lowTrust?: boolean } = {}) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const issueId = randomUUID();
    const responsibleUserId = `user-${randomUUID()}`;
    const targetUserId = `user-${randomUUID()}`;
    const now = new Date();
    await db.insert(companies).values({
      id: companyId,
      name: `Inbox ${companyId}`,
      issuePrefix: `IA${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(authUsers).values([
      {
        id: responsibleUserId,
        name: "Responsible",
        email: `${responsibleUserId}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: targetUserId,
        name: "Target",
        email: `${targetUserId}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(companyMemberships).values([
      {
        companyId,
        principalType: "user",
        principalId: responsibleUserId,
        status: "active",
        membershipRole: "operator",
      },
      {
        companyId,
        principalType: "user",
        principalId: targetUserId,
        status: "active",
        membershipRole: "operator",
      },
    ]);
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "InboxAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: input.lowTrust
        ? {
            trustPreset: LOW_TRUST_REVIEW_PRESET,
            authorizationPolicy: {
              trustBoundary: { mode: LOW_TRUST_REVIEW_PRESET, companyId },
            },
          }
        : {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      responsibleUserId,
      contextSnapshot: { issueId },
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Archive me",
      status: "todo",
      priority: "medium",
      createdByUserId: responsibleUserId,
    });
    return { companyId, agentId, runId, issueId, responsibleUserId, targetUserId };
  }

  function agentActor(seed: Awaited<ReturnType<typeof seed>>): Express.Request["actor"] {
    return {
      type: "agent",
      source: "agent_jwt",
      agentId: seed.agentId,
      companyId: seed.companyId,
      runId: seed.runId,
      onBehalfOfUserId: seed.responsibleUserId,
      onBehalfOfMemberships: [{
        companyId: seed.companyId,
        membershipRole: "operator",
        status: "active",
      }],
    };
  }

  it("lists only the current user's archived chats and rejects agents and other companies", async () => {
    const seeded = await seed();
    await issueService(db).archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId);
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId], memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }], isInstanceAdmin: false };
    const app = appFor(actor);
    const result = await request(app).get(`/api/companies/${seeded.companyId}/archived-chats`).expect(200);
    expect(result.body.map((row: { id: string }) => row.id)).toEqual([seeded.issueId]);
    await request(app).get(`/api/companies/${randomUUID()}/archived-chats`).expect(403);
    await request(appFor(agentActor(seeded))).get(`/api/companies/${seeded.companyId}/archived-chats`).expect(403);
    const other = appFor({ ...actor, userId: seeded.targetUserId });
    expect((await request(other).get(`/api/companies/${seeded.companyId}/archived-chats`).expect(200)).body).toEqual([]);
    expect((await request(app).get(`/api/companies/${seeded.companyId}/archived-chats?q=unmatched`).expect(200)).body).toEqual([]);
  });

  it("requires an owned archive and refuses unfinished tasks before deleting a completed leaf", async () => {
    const seeded = await seed();
    const svc = issueService(db);
    const scope = { companyId: seeded.companyId, userId: seeded.responsibleUserId };
    await expect(svc.remove(seeded.issueId, scope)).rejects.toThrow("currently archived by you");
    await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId);
    await expect(svc.remove(seeded.issueId, scope)).rejects.toThrow("Finish or cancel");
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, seeded.issueId));
    const childId = randomUUID();
    await db.insert(issues).values({ id: childId, companyId: seeded.companyId, parentId: seeded.issueId, title: "Keep child", status: "done" });
    await expect(svc.remove(seeded.issueId, scope)).rejects.toThrow("subtasks");
    await db.delete(issues).where(eq(issues.id, childId));
    await db.update(heartbeatRuns).set({ issueId: seeded.issueId }).where(eq(heartbeatRuns.id, seeded.runId));
    await expect(svc.remove(seeded.issueId, scope)).rejects.toThrow("active or paused");
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, seeded.runId));
    expect((await svc.remove(seeded.issueId, scope))?.id).toBe(seeded.issueId);
    expect(await db.select().from(issueInboxArchives)).toHaveLength(0);
  });

  it("previews an owned selection without deletion and hides unavailable records", async () => {
    const seeded = await seed();
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, seeded.issueId));
    await issueService(db).archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId);
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId], memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }], isInstanceAdmin: false };
    const app = appFor(actor);
    const unknown = randomUUID();
    const response = await request(app).post(`/api/companies/${seeded.companyId}/archived-chats/cleanup-preview`)
      .send({ issueIds: [seeded.issueId, unknown] }).expect(200);
    expect(response.body).toMatchObject({ previewOnly: true, truncated: false, items: [
      { id: seeded.issueId, protection: "candidate", title: "Archive me" }, { id: unknown, protection: "protected", title: null },
    ] });
    expect(await db.select().from(issues)).toHaveLength(1);
    expect(await db.select().from(issueInboxArchives)).toHaveLength(1);
    await request(appFor(agentActor(seeded))).post(`/api/companies/${seeded.companyId}/archived-chats/cleanup-preview`)
      .send({ issueIds: [seeded.issueId] }).expect(403);
    await request(app).post(`/api/companies/${randomUUID()}/archived-chats/cleanup-preview`)
      .send({ issueIds: [seeded.issueId] }).expect(403);
    await request(app).post(`/api/companies/${seeded.companyId}/archived-chats/cleanup-preview`)
      .send({ issueIds: [seeded.issueId], filters: {} }).expect(400);
    await db.update(heartbeatRuns).set({ issueId: seeded.issueId }).where(eq(heartbeatRuns.id, seeded.runId));
    const protectedResult = await request(app).post(`/api/companies/${seeded.companyId}/archived-chats/cleanup-preview`)
      .send({ filters: {} }).expect(200);
    expect(protectedResult.body.items[0].protection).toBe("protected");
    expect(protectedResult.body.items[0].reason).toContain("active or paused");
  });

  it("batch deletes only confirmed owned candidates, rechecks changed state, and reports failed file cleanup", async () => {
    const seeded = await seed();
    const other = await seed();
    const svc = issueService(db);
    const actor: Express.Request["actor"] = { type: "board", source: "session", userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId], memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }], isInstanceAdmin: false };
    const deleteObject = vi.fn().mockRejectedValue(new Error("storage temporarily unavailable"));
    const originalConfig = configModule.loadConfig();
    vi.spyOn(configModule, "loadConfig").mockReturnValue({ ...originalConfig, storageProvider: "s3" });
    const app = appFor(actor, { provider: "s3", deleteObject } as never);
    const endpoint = `/api/companies/${seeded.companyId}/archived-chats`;
    const staleId = randomUUID();
    const linkedId = randomUUID();
    const parentId = randomUUID();
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, seeded.issueId));
    await db.insert(issues).values([
      { id: staleId, companyId: seeded.companyId, title: "Changed after preview", status: "done" },
      { id: parentId, companyId: seeded.companyId, title: "Parent", status: "done" },
      { id: linkedId, companyId: seeded.companyId, parentId, title: "Linked leaf", status: "done" },
    ]);
    for (const id of [seeded.issueId, staleId, linkedId]) await svc.archiveInbox(seeded.companyId, id, seeded.responsibleUserId);
    const assetId = randomUUID();
    await db.insert(assets).values({ id: assetId, companyId: seeded.companyId, provider: "s3", objectKey: `${seeded.companyId}/test-only-object`,
      contentType: "text/plain", byteSize: 1024, sha256: "fixture-no-digest-computed" });
    await db.insert(issueAttachments).values({ companyId: seeded.companyId, issueId: seeded.issueId, assetId });
    const preview = await request(app).post(`${endpoint}/cleanup-preview`).send({ issueIds: [seeded.issueId, staleId, linkedId] }).expect(200);
    expect(preview.body.items[0]).toMatchObject({ localAttachmentBytes: 0, protection: "candidate" });
    expect(preview.body.items[0].databaseRecordBytes).toBeGreaterThan(0);
    expect(preview.body.items[2].protection).toBe("protected");
    const unfiltered = await request(app).post(`${endpoint}/cleanup-preview`).send({ issueIds: [linkedId], skipRelated: false }).expect(200);
    expect(unfiltered.body.items[0].protection).toBe("candidate");
    await expect(svc.remove(linkedId, { companyId: seeded.companyId, userId: seeded.responsibleUserId, skipRelated: true })).rejects.toThrow("parent, dependency");
    await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, staleId));
    await request(app).post(`${endpoint}/cleanup`).send({ issueIds: [seeded.issueId], skipRelated: true }).expect(400);
    await request(appFor(agentActor(seeded))).post(`${endpoint}/cleanup`).send({ issueIds: [seeded.issueId], skipRelated: true, confirm: true }).expect(403);
    await request(app).post(`/api/companies/${other.companyId}/archived-chats/cleanup`).send({ issueIds: [other.issueId], skipRelated: true, confirm: true }).expect(403);
    const result = await request(app).post(`${endpoint}/cleanup`).send({ issueIds: [seeded.issueId, seeded.issueId, staleId, linkedId, other.issueId], skipRelated: true, confirm: true }).expect(200);
    expect(result.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: seeded.issueId, status: "deleted", fileCleanupFailed: true }),
      expect.objectContaining({ id: staleId, status: "skipped" }), expect.objectContaining({ id: linkedId, status: "skipped" }),
      expect.objectContaining({ id: other.issueId, status: "skipped" }),
    ]));
    expect(result.body.items).toHaveLength(4);
    expect(result.body.estimatedLocalBytesRemoved).toBe(0);
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(seeded.companyId, `${seeded.companyId}/test-only-object`);
    const pending = await request(app).get(`${endpoint}/pending-cleanup`).expect(200);
    expect(pending.body[0].files[0].status).toBe("failed");
    deleteObject.mockResolvedValue(undefined);
    await Promise.all([0, 1].map(() => request(app).post(`${endpoint}/pending-cleanup/${pending.body[0].id}/retry`).send({}).expect(200)));
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect((await request(app).get(`${endpoint}/pending-cleanup`).expect(200)).body).toEqual([]);
    expect((await db.select().from(activityLog)).some((row) => row.action === "issue.deleted" && row.entityId === seeded.issueId)).toBe(true);
    expect(await svc.getById(staleId)).not.toBeNull();
    expect(await svc.getById(other.issueId)).not.toBeNull();
    const retry = await request(app).post(`${endpoint}/cleanup`).send({ issueIds: [seeded.issueId], skipRelated: true, confirm: true }).expect(200);
    expect(retry.body.items[0].status).toBe("skipped");
  });

  it("excludes both ends of dependencies and task mentions unless explicitly unchecked", async () => {
    const seeded = await seed();
    const ids = [seeded.issueId, randomUUID(), randomUUID()];
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, ids[0]));
    await db.insert(issues).values(ids.slice(1).map((id) => ({ id, companyId: seeded.companyId, title: "Linked", status: "done" })));
    const svc = issueService(db);
    for (const id of ids) await svc.archiveInbox(seeded.companyId, id, seeded.responsibleUserId);
    await db.insert(issueRelations).values({ companyId: seeded.companyId, issueId: ids[0], relatedIssueId: ids[1], type: "blocks" });
    await db.insert(issueReferenceMentions).values({ companyId: seeded.companyId, sourceIssueId: ids[1], targetIssueId: ids[2], sourceKind: "title" });
    expect((await svc.previewArchivedChatCleanup(seeded.companyId, seeded.responsibleUserId, ids)).map((row) => row.protection)).toEqual(["protected", "protected", "protected"]);
    expect((await svc.previewArchivedChatCleanup(seeded.companyId, seeded.responsibleUserId, ids, undefined, false)).map((row) => row.protection)).toEqual(["candidate", "candidate", "candidate"]);
  });

  it("physically cleans owned attachments and logs, retains linked files, and persists retryable jobs", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "paperclip-archive-files-"));
    try {
      vi.stubEnv("PAPERCLIP_STORAGE_LOCAL_DIR", path.join(folder, "files"));
      vi.stubEnv("RUN_LOG_BASE_PATH", path.join(folder, "logs"));
      const seeded = await seed();
      const svc = issueService(db);
      await db.update(issues).set({ status: "done" }).where(eq(issues.id, seeded.issueId));
      await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId);
      const actor: Express.Request["actor"] = { type: "board", source: "session", userId: seeded.responsibleUserId,
        companyIds: [seeded.companyId], memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }], isInstanceAdmin: false };
      const key = `${seeded.companyId}/asset.txt`;
      const attachment = path.join(folder, "files", key);
      const logRef = path.join(seeded.companyId, seeded.agentId, seeded.runId + ".ndjson");
      const log = path.join(folder, "logs", logRef);
      await mkdir(path.dirname(attachment), { recursive: true });
      await mkdir(path.dirname(log), { recursive: true });
      await writeFile(attachment, "asset"); await writeFile(log, "run log");
      const assetId = randomUUID();
      await db.insert(assets).values({ id: assetId, companyId: seeded.companyId, provider: "local_disk", objectKey: key,
        contentType: "text/plain", byteSize: 5, sha256: "fixture-no-digest-computed" });
      await db.insert(issueAttachments).values({ companyId: seeded.companyId, issueId: seeded.issueId, assetId });
      await db.update(heartbeatRuns).set({ status: "succeeded", issueId: seeded.issueId, logStore: "local_file", logRef, logBytes: 7 }).where(eq(heartbeatRuns.id, seeded.runId));
      const app = appFor(actor, { provider: "local_disk" } as never);
      const endpoint = `/api/companies/${seeded.companyId}/archived-chats`;
      const preview = await request(app).post(`${endpoint}/cleanup-preview`).send({ issueIds: [seeded.issueId] }).expect(200);
      expect(preview.body.items[0].filePlan.localBytes).toBe(12);
      const result = await request(app).post(`${endpoint}/cleanup`).send({ issueIds: [seeded.issueId], skipRelated: true, confirm: true }).expect(200);
      expect(result.body.items[0]).toMatchObject({ status: "deleted", fileCleanupFailed: false });
      expect(result.body.estimatedLocalBytesRemoved).toBe(12);
      await expect(stat(attachment)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(log)).rejects.toMatchObject({ code: "ENOENT" });
      const jobId = result.body.items[0].cleanupJobId;
      const retry = await request(app).post(`${endpoint}/pending-cleanup/${jobId}/retry`).send({}).expect(200);
      expect(retry.body.removedBytes).toBe(12);
      expect((await request(app).get(`${endpoint}/pending-cleanup`).expect(200)).body).toEqual([]);
      await request(appFor({ ...actor, userId: seeded.targetUserId })).post(`${endpoint}/pending-cleanup/${jobId}/retry`).send({}).expect(404);
      expect((await db.select().from(archiveCleanupJobs)).find((row) => row.id === jobId)?.status).toBe("completed");
      // Simulate an interrupted cleanup followed by replacement of the file at the same path.
      const [saved] = await db.select().from(archiveCleanupJobs).where(eq(archiveCleanupJobs.id, jobId));
      await writeFile(attachment, "new unconfirmed content");
      await db.update(archiveCleanupJobs).set({ status: "pending", files: saved.files.map((file) => file.kind === "attachment" ? { ...file, status: "pending" as const } : file) }).where(eq(archiveCleanupJobs.id, jobId));
      const changed = await request(app).post(`${endpoint}/pending-cleanup/${jobId}/retry`).send({}).expect(200);
      expect(changed.body.files.find((file: { kind: string }) => file.kind === "attachment").status).toBe("failed");
      expect(await readFile(attachment, "utf8")).toBe("new unconfirmed content");
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it("removes only a clean merged exclusive worktree and retains unregistered files", async () => {
    const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "archive-worktree-")));
    try {
      const repo = path.join(folder, "repo"); const copy = path.join(folder, "copy");
      await mkdir(repo);
      const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { stdio: "pipe" });
      git("init", "-b", "main"); await writeFile(path.join(repo, "source.txt"), "preserved source"); git("add", "source.txt");
      git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture"); git("worktree", "add", "-b", "task-copy", copy);
      const seeded = await seed(); const projectId = randomUUID(); const rootId = randomUUID(); const workspaceId = randomUUID();
      await db.insert(projects).values({ id: projectId, companyId: seeded.companyId, name: "Disposable copy test" });
      await db.insert(projectWorkspaces).values({ id: rootId, companyId: seeded.companyId, projectId, name: "Source", cwd: repo, isPrimary: true });
      await db.insert(executionWorkspaces).values({ id: workspaceId, companyId: seeded.companyId, projectId, projectWorkspaceId: rootId,
        sourceIssueId: seeded.issueId, mode: "isolated", strategyType: "git_worktree", providerType: "git_worktree", name: "Task copy",
        status: "archived", cwd: copy, providerRef: copy, branchName: "task-copy", baseRef: "main", metadata: { createdByRuntime: true } });
      await db.update(issues).set({ status: "done", projectId, executionWorkspaceId: workspaceId }).where(eq(issues.id, seeded.issueId));
      await writeFile(path.join(copy, "unregistered.txt"), "keep this");
      const protectedPlan = await buildArchiveCleanupPlan(db, seeded.companyId, seeded.issueId);
      expect(protectedPlan.files.some((file) => file.kind === "workspace")).toBe(false);
      await unlink(path.join(copy, "unregistered.txt"));
      await writeFile(path.join(repo, ".git", "info", "exclude"), "secret.bin\n");
      await writeFile(path.join(copy, "secret.bin"), "ignored but not disposable");
      expect((await buildArchiveCleanupPlan(db, seeded.companyId, seeded.issueId)).files.some((file) => file.kind === "workspace")).toBe(false);
      await unlink(path.join(copy, "secret.bin"));
      const plan = await buildArchiveCleanupPlan(db, seeded.companyId, seeded.issueId);
      expect(plan.files.some((file) => file.kind === "workspace")).toBe(true);
      const svc = issueService(db); await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId);
      const jobId = randomUUID();
      await svc.remove(seeded.issueId, { companyId: seeded.companyId, userId: seeded.responsibleUserId, cleanupJobId: jobId });
      await db.update(executionWorkspaces).set({ status: "active" }).where(eq(executionWorkspaces.id, workspaceId));
      const reopened = await executeArchiveCleanupJob(db, { provider: "local_disk" } as never, seeded.companyId, seeded.responsibleUserId, jobId);
      expect(reopened.files.find((file) => file.kind === "workspace")?.status).toBe("failed");
      expect((await stat(copy)).isDirectory()).toBe(true);
      await db.update(executionWorkspaces).set({ status: "archived" }).where(eq(executionWorkspaces.id, workspaceId));
      const result = await executeArchiveCleanupJob(db, { provider: "local_disk" } as never, seeded.companyId, seeded.responsibleUserId, jobId);
      expect(result.files.find((file) => file.kind === "workspace")?.status).toBe("removed");
      await expect(stat(copy)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(repo, "source.txt"), "utf8")).toBe("preserved source");
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it("preserves board idempotency and returns the resolved user", async () => {
    const seeded = await seed();
    const app = appFor({
      type: "board",
      source: "session",
      userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId],
      memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }],
      isInstanceAdmin: false,
    });

    const first = await request(app).post(`/api/issues/${seeded.issueId}/inbox-archive`).send({}).expect(200);
    const second = await request(app).post(`/api/issues/${seeded.issueId}/inbox-archive`).send({}).expect(200);
    expect(first.body).toMatchObject({ userId: seeded.responsibleUserId, archivedByActorType: "user" });
    expect(second.body.id).toBe(first.body.id);
    expect(await db.select().from(issueInboxArchives)).toHaveLength(1);

    await request(app).delete(`/api/issues/${seeded.issueId}/inbox-archive`).send({}).expect(200);
    await request(app)
      .delete(`/api/issues/${seeded.issueId}/inbox-archive`)
      .send({})
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ ok: true, userId: seeded.responsibleUserId }));
  });

  it.each([false, true])("allows manual archive during human completion (existing archive: %s)", async (alreadyArchived) => {
    const seeded = await seed();
    const svc = issueService(db);
    if (alreadyArchived) {
      await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId);
    }
    const app = appFor({
      type: "board",
      source: "session",
      userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId],
      memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }],
      isInstanceAdmin: false,
    });
    let manualArchive: Promise<{ status: number }> | undefined;
    let completed: Awaited<ReturnType<typeof svc.update>>;
    let manualStatus: number | undefined;
    try {
      completed = await db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '5s'`);
        // Human completion locks the issue before it writes the archive.
        await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, seeded.issueId)).for("update");
        const [{ pid }] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        manualArchive = request(app).post(`/api/issues/${seeded.issueId}/inbox-archive`).send({}).then((response) => response);
        await expect.poll(async () => {
          const blocked = await db.execute(sql`
            select 1 from pg_stat_activity
            where datname = current_database() and ${pid} = any(pg_blocking_pids(pid))
          `);
          return blocked.length;
        }, { timeout: 3_000 }).toBeGreaterThan(0);

        // The manual request is now waiting on our parent row. Previously it
        // already owned the archive insert, so this completion formed a cycle.
        return svc.update(seeded.issueId, {
          status: "done",
          actorUserId: seeded.responsibleUserId,
          companyGuard: seeded.companyId,
        }, tx, []);
      });
    } finally {
      // Do not leave an in-flight route writing into the next test's fixture.
      if (manualArchive) manualStatus = (await manualArchive).status;
    }
    expect(manualStatus).toBe(200);
    expect(completed!.status).toBe("done");
    const archives = await db.select().from(issueInboxArchives);
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({
      companyId: seeded.companyId,
      issueId: seeded.issueId,
      userId: seeded.responsibleUserId,
      archivedByActorType: "user",
      archivedByAgentId: null,
      archivedByRunId: null,
    });
    const audits = await db.select().from(activityLog).where(eq(activityLog.action, "issue.inbox_archived"));
    expect(audits).toHaveLength(2);
    expect(audits.some((audit) => audit.details?.source === "issue_status_done")).toBe(true);
    expect(archives[0].archivedAt.getTime()).toBeGreaterThanOrEqual(completed!.completedAt!.getTime());
    // The status route records this activity after the completion transaction.
    await db.insert(activityLog).values({
      companyId: seeded.companyId,
      actorType: "user",
      actorId: seeded.responsibleUserId,
      action: "issue.updated",
      entityType: "issue",
      entityId: seeded.issueId,
      details: { status: "done", _previous: { status: "todo" } },
    });
    await request(app).get(`/api/companies/${seeded.companyId}/issues`)
      .query({ touchedByUserId: seeded.responsibleUserId, inboxArchivedByUserId: seeded.responsibleUserId, status: "done" })
      .expect(200)
      .expect(({ body }) => expect(body.map((issue: { id: string }) => issue.id)).not.toContain(seeded.issueId));
  });

  it("keeps caller rollback atomic without blocking a different user's archive", async () => {
    const seeded = await seed();
    const svc = issueService(db);
    const rollback = new Error("Roll back the first user's archive");
    await expect(db.transaction(async (tx) => {
      await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId, new Date(), undefined, tx);
      // An exclusive parent lock would unnecessarily serialize these users.
      await db.transaction(async (otherTx) => {
        await otherTx.execute(sql`set local statement_timeout = '3s'`);
        await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.targetUserId, new Date(), undefined, otherTx);
      });
      throw rollback;
    })).rejects.toBe(rollback);
    const archives = await db.select().from(issueInboxArchives);
    expect(archives).toHaveLength(1);
    expect(archives[0].userId).toBe(seeded.targetUserId);
  });

  it.each([-1, 0, 1])("keeps the newest archive time and matching attribution (offset: %s)", async (offset) => {
    const seeded = await seed();
    const svc = issueService(db);
    const firstTime = new Date("2000-01-02T00:00:00.000Z");
    const nextTime = new Date(firstTime.getTime() + offset * 1_000);
    const first = await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId, firstTime, {
      archivedByActorType: "agent",
      archivedByAgentId: seeded.agentId,
      archivedByRunId: seeded.runId,
    });
    const next = await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId, nextTime);
    expect(next.id).toBe(first.id);
    expect(next).toMatchObject(offset < 0 ? first : {
      archivedAt: nextTime,
      archivedByActorType: "user",
      archivedByAgentId: null,
      archivedByRunId: null,
    });
    expect(await db.select().from(issueInboxArchives)).toEqual([next]);

    await svc.unarchiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId);
    const afterUndo = await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId, nextTime);
    expect(afterUndo).toMatchObject({ archivedAt: nextTime, archivedByActorType: "user" });
    expect(afterUndo.id).not.toBe(first.id);
  });

  it("holds the issue company stable until its archive transaction ends", async () => {
    const seeded = await seed();
    const otherCompany = await seed();
    const svc = issueService(db);
    let move: Promise<unknown> | undefined;
    try {
      await db.transaction(async (tx) => {
        await svc.archiveInbox(seeded.companyId, seeded.issueId, seeded.responsibleUserId, new Date(), undefined, tx);
        const [{ pid }] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        move = db.update(issues).set({ companyId: otherCompany.companyId })
          .where(eq(issues.id, seeded.issueId)).then((rows) => rows);
        await expect.poll(async () => {
          const blocked = await db.execute(sql`
            select 1 from pg_stat_activity
            where datname = current_database() and ${pid} = any(pg_blocking_pids(pid))
          `);
          return blocked.length;
        }, { timeout: 3_000 }).toBeGreaterThan(0);
        const [stillOwned] = await tx.select().from(issues).where(eq(issues.id, seeded.issueId));
        expect(stillOwned.companyId).toBe(seeded.companyId);
      });
    } finally {
      await move;
    }
    const [moved] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(moved.companyId).toBe(otherCompany.companyId);
  });

  it("rejects missing and cross-company issues before archiving", async () => {
    const seeded = await seed();
    const svc = issueService(db);
    const otherCompany = await seed();
    for (const [companyId, issueId] of [
      [otherCompany.companyId, seeded.issueId],
      [seeded.companyId, randomUUID()],
    ]) {
      await expect(svc.archiveInbox(companyId, issueId, seeded.responsibleUserId))
        .rejects.toMatchObject({ status: 404, message: "Issue not found" });
    }
    expect(await db.select().from(issueInboxArchives)).toHaveLength(0);
  });

  it("silently archives an issue for the board user who moves it to done", async () => {
    const seeded = await seed();
    const app = appFor({
      type: "board",
      source: "session",
      userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId],
      memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }],
      isInstanceAdmin: false,
    });

    await request(app)
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ status: "done" })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: seeded.issueId, status: "done" }));

    const [archive] = await db
      .select()
      .from(issueInboxArchives)
      .where(eq(issueInboxArchives.issueId, seeded.issueId));
    expect(archive).toMatchObject({
      issueId: seeded.issueId,
      userId: seeded.responsibleUserId,
      archivedByActorType: "user",
      archivedByAgentId: null,
      archivedByRunId: null,
    });

    const [archiveAudit] = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "issue.inbox_archived"));
    expect(archiveAudit).toMatchObject({
      actorType: "user",
      actorId: seeded.responsibleUserId,
      entityId: seeded.issueId,
      details: {
        userId: seeded.responsibleUserId,
        targetResolvedFrom: "responsible_user",
        source: "issue_status_done",
      },
    });

    await request(app)
      .get(`/api/companies/${seeded.companyId}/issues`)
      .query({
        touchedByUserId: seeded.responsibleUserId,
        inboxArchivedByUserId: seeded.responsibleUserId,
        status: "backlog,todo,in_progress,in_review,blocked,done",
      })
      .expect(200)
      .expect(({ body }) => expect(body.map((issue: { id: string }) => issue.id)).not.toContain(seeded.issueId));
  });

  it("rolls back completion when the inbox archive audit cannot be written", async () => {
    const seeded = await seed();
    const liveEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const unsubscribe = subscribeCompanyLiveEvents(seeded.companyId, (event) => liveEvents.push(event));
    const app = appFor({
      type: "board",
      source: "session",
      userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId],
      memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }],
      isInstanceAdmin: false,
    });

    await db.execute(sql`
      alter table activity_log
      add constraint reject_done_inbox_archive_audit
      check (action <> 'issue.inbox_archived')
    `);
    try {
      await request(app)
        .patch(`/api/issues/${seeded.issueId}`)
        .send({ status: "done" })
        .expect(500);
      expect(liveEvents).not.toContainEqual(expect.objectContaining({
        type: "activity.logged",
        payload: expect.objectContaining({ action: "issue.inbox_archived" }),
      }));
    } finally {
      unsubscribe();
      await db.execute(sql`
        alter table activity_log
        drop constraint reject_done_inbox_archive_audit
      `);
    }

    const [issue] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    expect(issue.status).toBe("todo");
    expect(await db.select().from(issueInboxArchives)).toHaveLength(0);
  });

  it("does not archive a responsible user's inbox when an agent moves an issue to done", async () => {
    const seeded = await seed();

    await request(appFor(agentActor(seeded)))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ status: "done" })
      .expect(200);

    expect(await db.select().from(issueInboxArchives)).toHaveLength(0);
  });

  it("archives for the responsible user with agent/run attribution and resurfaces after new activity", async () => {
    const seeded = await seed();
    const app = appFor(agentActor(seeded));

    await request(app)
      .post(`/api/issues/${seeded.issueId}/inbox-archive`)
      .send({})
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        userId: seeded.responsibleUserId,
        archivedByActorType: "agent",
        archivedByAgentId: seeded.agentId,
        archivedByRunId: seeded.runId,
      }));

    const [audit] = await db.select().from(activityLog);
    expect(audit).toMatchObject({
      action: "issue.inbox_archived",
      actorType: "agent",
      agentId: seeded.agentId,
      runId: seeded.runId,
      details: {
        userId: seeded.responsibleUserId,
        targetResolvedFrom: "responsible_user",
        policyMode: "open",
      },
    });

    const archivedList = await request(app)
      .get(`/api/companies/${seeded.companyId}/issues`)
      .query({ touchedByUserId: seeded.responsibleUserId })
      .expect(200);
    expect(archivedList.body[0]).toMatchObject({
      id: seeded.issueId,
      archivedByActorType: "agent",
      archivedByAgentId: seeded.agentId,
      archivedByRunId: seeded.runId,
    });

    const boardApp = appFor({
      type: "board",
      source: "session",
      userId: seeded.responsibleUserId,
      companyIds: [seeded.companyId],
      memberships: [{ companyId: seeded.companyId, membershipRole: "operator", status: "active" }],
      isInstanceAdmin: false,
    });
    await request(boardApp)
      .get(`/api/issues/${seeded.issueId}`)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        id: seeded.issueId,
        archivedAt: expect.any(String),
        archivedByActorType: "agent",
        archivedByAgentId: seeded.agentId,
        archivedByRunId: seeded.runId,
      }));

    await db.insert(issueComments).values({
      companyId: seeded.companyId,
      issueId: seeded.issueId,
      authorUserId: seeded.targetUserId,
      body: "New work arrived",
      createdAt: new Date(Date.now() + 1000),
      updatedAt: new Date(Date.now() + 1000),
    });
    const resurfaced = await request(app)
      .get(`/api/companies/${seeded.companyId}/issues`)
      .query({
        touchedByUserId: seeded.responsibleUserId,
        inboxArchivedByUserId: seeded.responsibleUserId,
      })
      .expect(200);
    expect(resurfaced.body[0]).toMatchObject({ id: seeded.issueId });
    expect(resurfaced.body[0].archivedByAgentId).toBeUndefined();
    await request(boardApp)
      .get(`/api/issues/${seeded.issueId}`)
      .expect(200)
      .expect(({ body }) => expect(body.archivedByAgentId).toBeUndefined());
  });

  it("returns stable typed denials for unresolved, disabled, allowlist, and low-trust actors", async () => {
    const unresolved = await seed();
    const unresolvedActor = agentActor(unresolved);
    unresolvedActor.onBehalfOfUserId = null;
    unresolvedActor.onBehalfOfMemberships = [];
    await request(appFor(unresolvedActor))
      .post(`/api/issues/${unresolved.issueId}/inbox-archive`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("inbox_target_user_unresolved"));

    const disabled = await seed();
    await db.insert(userInboxAgentPolicies).values({
      companyId: disabled.companyId,
      userId: disabled.responsibleUserId,
      mode: "disabled",
    });
    await request(appFor(agentActor(disabled)))
      .post(`/api/issues/${disabled.issueId}/inbox-archive`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("inbox_management_disabled"));

    const allowlist = await seed();
    await db.insert(userInboxAgentPolicies).values({
      companyId: allowlist.companyId,
      userId: allowlist.responsibleUserId,
      mode: "allowlist",
      allowedAgentIds: [],
    });
    await request(appFor(agentActor(allowlist)))
      .post(`/api/issues/${allowlist.issueId}/inbox-archive`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("inbox_agent_not_allowed"));
    await db
      .update(userInboxAgentPolicies)
      .set({ allowedAgentIds: [allowlist.agentId] })
      .where(eq(userInboxAgentPolicies.companyId, allowlist.companyId));
    await request(appFor(agentActor(allowlist)))
      .post(`/api/issues/${allowlist.issueId}/inbox-archive`)
      .send({})
      .expect(200);

    const lowTrust = await seed({ lowTrust: true });
    await request(appFor(agentActor(lowTrust)))
      .post(`/api/issues/${lowTrust.issueId}/inbox-archive`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("inbox_agent_not_allowed"));
  });

  it("requires a scoped grant for cross-user archive and unarchive", async () => {
    const seeded = await seed();
    const app = appFor(agentActor(seeded));

    await request(app)
      .post(`/api/issues/${seeded.issueId}/inbox-archive`)
      .send({ userId: seeded.targetUserId })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe("inbox_cross_user_grant_required"));

    await db.insert(companyMemberships).values({
      companyId: seeded.companyId,
      principalType: "agent",
      principalId: seeded.agentId,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: seeded.companyId,
      principalType: "agent",
      principalId: seeded.agentId,
      permissionKey: "inbox:manage",
      scope: { userIds: [seeded.targetUserId] },
    });
    await db.insert(userInboxAgentPolicies).values({
      companyId: seeded.companyId,
      userId: seeded.targetUserId,
      mode: "disabled",
    });

    await request(app)
      .post(`/api/issues/${seeded.issueId}/inbox-archive`)
      .send({ userId: seeded.targetUserId })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ userId: seeded.targetUserId }));
    await request(app)
      .delete(`/api/issues/${seeded.issueId}/inbox-archive`)
      .send({ userId: seeded.targetUserId })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ userId: seeded.targetUserId }));

    const auditRows = await db.select().from(activityLog);
    expect(auditRows.find((row) => row.action === "issue.inbox_unarchived")).toMatchObject({
      actorType: "agent",
      agentId: seeded.agentId,
      runId: seeded.runId,
    });
    expect(auditRows.map((row) => row.details)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: seeded.targetUserId,
        targetResolvedFrom: "explicit",
        policyMode: "grant_override",
      }),
    ]));
  });

  it("honors the target user's allowlist for explicit archive and unarchive", async () => {
    const seeded = await seed();
    const app = appFor(agentActor(seeded));
    await db.insert(userInboxAgentPolicies).values({
      companyId: seeded.companyId,
      userId: seeded.targetUserId,
      mode: "allowlist",
      allowedAgentIds: [seeded.agentId],
    });

    await request(app)
      .post(`/api/issues/${seeded.issueId}/inbox-archive`)
      .send({ userId: seeded.targetUserId })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ userId: seeded.targetUserId }));
    await request(app)
      .delete(`/api/issues/${seeded.issueId}/inbox-archive`)
      .send({ userId: seeded.targetUserId })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ userId: seeded.targetUserId }));

    const auditRows = await db.select().from(activityLog);
    expect(auditRows.map((row) => row.details)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: seeded.targetUserId,
        targetResolvedFrom: "explicit",
        policyMode: "allowlist",
      }),
    ]));
  });
});
