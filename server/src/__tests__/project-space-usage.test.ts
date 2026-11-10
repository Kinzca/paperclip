import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, projects, projectWorkspaces } from "@paperclipai/db";
import { companyProjectSpaceUsage } from "../services/project-space-usage.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("project space inventory", () => {
  let temporaryDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let folder: string;
  beforeAll(async () => {
    temporaryDb = await startEmbeddedPostgresTestDatabase("paperclip-project-space-");
    db = createDb(temporaryDb.connectionString);
    folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "paperclip-space-company-")));
  }, 20000);
  afterAll(async () => { await temporaryDb?.cleanup(); if (folder) await rm(folder, { recursive: true, force: true }); });

  it("keeps companies isolated and counts a nested knowledge project only once", async () => {
    const a = randomUUID(); const b = randomUUID();
    const parent = randomUUID(); const child = randomUUID(); const foreign = randomUUID();
    await db.insert(companies).values([{ id: a, name: "Content", issuePrefix: "SPA" }, { id: b, name: "Other", issuePrefix: "SPB" }]);
    await db.insert(projects).values([{ id: parent, companyId: a, name: "Content root" },
      { id: child, companyId: a, name: "Knowledge" }, { id: foreign, companyId: b, name: "Foreign" }]);
    const nested = path.join(folder, "knowledge"); await mkdir(nested);
    await writeFile(path.join(folder, "source.txt"), "12345678");
    await writeFile(path.join(nested, "page.md"), "1234");
    await db.insert(projectWorkspaces).values([
      { companyId: a, projectId: parent, name: "Root", cwd: folder, sourceType: "non_git_path" },
      { companyId: a, projectId: parent, name: "Duplicate root", cwd: folder, sourceType: "non_git_path" },
      { companyId: a, projectId: child, name: "Knowledge", cwd: nested, sourceType: "non_git_path" },
      { companyId: b, projectId: foreign, name: "Foreign", cwd: path.join(folder, "does-not-exist"), sourceType: "local_path" },
    ]);
    const result = await companyProjectSpaceUsage(db, a, sql`true`);
    expect(result.previewOnly).toBe(true);
    expect(result.projects.map((project) => project.id).sort()).toEqual([parent, child].sort());
    expect(result.exclusiveBytes).toBe(0);
    expect(result.sharedBytes).toBe(12);
    expect(result.projects.find((project) => project.id === parent)?.roots).toHaveLength(1);
    expect(result.projects.flatMap((project) => project.roots).every((root) => root.shared)).toBe(true);
    expect(result.projects.flatMap((project) => project.roots).flatMap((root) => root.directories).every((entry) => entry.protection === "protected")).toBe(true);
    // Inventory leaves source and registry data intact.
    expect((await db.select().from(projectWorkspaces))).toHaveLength(4);
  });
});
