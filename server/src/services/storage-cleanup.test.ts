import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Config } from "../config.js";
import { withBackupDirectoryLock } from "@paperclipai/db";
import { previewStorageCleanup, executeStorageCleanup, storageCleanupInventory } from "./storage-cleanup.js";

const processScan = vi.hoisted(() => ({ referenced: false }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const fake = Object.assign(vi.fn(), { [promisify.custom]: async (command: string) => {
    if (command === "ps") return { stdout: processScan.referenced ? process.env.PAPERCLIP_LOCAL_DIR + "/releases/cccccccccccc/runtime" : "", stderr: "" };
    throw Object.assign(new Error("no open files"), { code: 1, stdout: "", stderr: "" });
  } });
  return { ...actual, execFile: fake };
});

let root: string; let config: Config;
const db = { select: () => ({ from: async () => [] }) } as unknown as Db;
const audit = vi.fn(async () => {});
const oldId = "backups:paperclip-20261110-120000.sql.gz";
const latestId = "backups:paperclip-20261111-120000.sql.gz";
const releaseId = "releases:cccccccccccc";
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "paperclip-storage-cleanup-")));
  config = { databaseBackupDir: path.join(root, "backups") } as Config;
  await mkdir(config.databaseBackupDir);
  await writeFile(path.join(config.databaseBackupDir, oldId.split(":")[1]), "old");
  await utimes(path.join(config.databaseBackupDir, oldId.split(":")[1]), 1, 1);
  await writeFile(path.join(config.databaseBackupDir, latestId.split(":")[1]), "latest");
  for (const id of ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"]) {
    await mkdir(path.join(root, "releases", id), { recursive: true });
    await writeFile(path.join(root, "releases", id, "program.js"), id);
  }
  const checkpoint = path.join(root, "checkpoints", "123456-aaaaaaaaaaaa-to-bbbbbbbbbbbb");
  await mkdir(checkpoint, { recursive: true });
  await writeFile(path.join(root, "current.json"), JSON.stringify({ release: "aaaaaaaaaaaa", previous: "bbbbbbbbbbbb", checkpoint }));
  vi.stubEnv("PAPERCLIP_LOCAL_DIR", root);
  // Test-only deployment lock implementation; real deployments use the native release-lib lock.
  const library = path.join(root, "lock.mjs");
  await writeFile(library, 'import fs from "node:fs"; export function lock(root) { const file=root+"/deployment.lock"; fs.writeFileSync(file,"locked",{flag:"wx"}); return ()=>fs.unlinkSync(file); }');
  vi.stubEnv("PAPERCLIP_RELEASE_LIB", library);
  audit.mockClear(); processScan.referenced = false;
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("explicit storage deletion boundaries", () => {
  it("retains latest backup, current/previous releases and referenced checkpoint", async () => {
    const inventory = await storageCleanupInventory(config, db);
    expect(inventory.items.filter(item => item.protectedReason)).toHaveLength(4);
    for (const id of [latestId, "releases:aaaaaaaaaaaa", "releases:bbbbbbbbbbbb", "checkpoints:123456-aaaaaaaaaaaa-to-bbbbbbbbbbbb"])
      await expect(previewStorageCleanup(config, db, [id], "user")).rejects.toThrow();
    await expect(previewStorageCleanup(config, db, ["backups:../../outside"], "user")).rejects.toThrow();
  });
  it("requires an owned single-use preview and deletes only explicitly selected old backup", async () => {
    const plan = await previewStorageCleanup(config, db, [oldId], "user");
    await expect(executeStorageCleanup(config, db, plan.token, "other", audit)).rejects.toThrow();
    const result = await executeStorageCleanup(config, db, plan.token, "user", audit);
    expect(result.results[0].status).toBe("deleted");
    expect(await readFile(path.join(config.databaseBackupDir, latestId.split(":")[1]), "utf8")).toBe("latest");
    await expect(executeStorageCleanup(config, db, plan.token, "user", audit)).rejects.toThrow();
    expect(audit).toHaveBeenCalledTimes(2);
  });
  it("retains files changed after preview and refuses symlink ancestors", async () => {
    const plan = await previewStorageCleanup(config, db, [oldId], "user");
    await writeFile(plan.items[0].path, "changed");
    expect((await executeStorageCleanup(config, db, plan.token, "user", audit)).results[0].status).toBe("failed");
    const linked = path.join(root, "linked"); await symlink(config.databaseBackupDir, linked);
    const inventory = await storageCleanupInventory({ ...config, databaseBackupDir: linked }, db);
    expect(inventory.unavailable.length).toBeGreaterThan(0);
    expect(inventory.items.some(item => item.kind === "backups")).toBe(false);
  });
  it("serializes deletion with backup writes and refuses audit failure", async () => {
    const plan = await previewStorageCleanup(config, db, [oldId], "user");
    await withBackupDirectoryLock(config.databaseBackupDir, async () => {
      await expect(executeStorageCleanup(config, db, plan.token, "user", audit)).rejects.toThrow();
    });
    const next = await previewStorageCleanup(config, db, [oldId], "user");
    await expect(executeStorageCleanup(config, db, next.token, "user", async () => { throw new Error("audit offline"); })).rejects.toThrow("audit offline");
    expect(await readFile(next.items[0].path, "utf8")).toBe("old");
  });
  it("rechecks deployment references and locks at execution", async () => {
    const plan = await previewStorageCleanup(config, db, [releaseId], "user");
    await writeFile(path.join(root, "deployment.lock"), "other deployment");
    await expect(executeStorageCleanup(config, db, plan.token, "user", audit)).rejects.toThrow();
    await rm(path.join(root, "deployment.lock"));
    const next = await previewStorageCleanup(config, db, [releaseId], "user");
    await writeFile(path.join(root, "current.json"), JSON.stringify({ release: "cccccccccccc" }));
    expect((await executeStorageCleanup(config, db, next.token, "user", audit)).results[0].status).toBe("failed");
  });
  it("protects process references; deletes an unreferenced selected release", async () => {
    const plan = await previewStorageCleanup(config, db, [releaseId], "user");
    processScan.referenced = true;
    expect((await executeStorageCleanup(config, db, plan.token, "user", audit)).results[0].status).toBe("failed");
    processScan.referenced = false;
    const next = await previewStorageCleanup(config, db, [releaseId], "user");
    expect((await executeStorageCleanup(config, db, next.token, "user", audit)).results[0].status).toBe("deleted");
  });
  it("expires previews and retains a backup replaced with a symlink", async () => {
    const plan = await previewStorageCleanup(config, db, [oldId], "user");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    await expect(executeStorageCleanup(config, db, plan.token, "user", audit)).rejects.toThrow();
    clock.mockRestore();
    const next = await previewStorageCleanup(config, db, [oldId], "user");
    const outside = path.join(root, "valuable.sql.gz"); await writeFile(outside, "keep");
    await rm(next.items[0].path); await symlink(outside, next.items[0].path);
    expect((await executeStorageCleanup(config, db, next.token, "user", audit)).results[0].status).toBe("failed");
    expect(await readFile(outside, "utf8")).toBe("keep");
  });
  it("cleans only an explicitly selected historical checkpoint and reports audit completion failure", async () => {
    const name = "123455-dddddddddddd-to-eeeeeeeeeeee";
    const target = path.join(root, "checkpoints", name); await mkdir(target);
    await writeFile(path.join(target, "before-upgrade.sql.gz"), "old recovery data");
    const plan = await previewStorageCleanup(config, db, ["checkpoints:" + name], "user");
    const result = await executeStorageCleanup(config, db, plan.token, "user", async phase => {
      if (phase === "finished") throw new Error("audit connection lost");
    });
    expect(result.results[0].status).toBe("deleted");
    expect(result.auditWarning).toContain("audit connection lost");
    expect((await storageCleanupInventory(config, db)).items.find(item => item.kind === "checkpoints")?.protectedReason).toBeTruthy();
  });

});
