import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectCleanupFile } from "./archive-cleanup-files.js";
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
it("measures owned regular files and rejects traversal or symlink targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "archive-cleanup-safety-"));
  temporary.push(root);
  const storage = path.join(root, "storage");
  await mkdir(storage); await writeFile(path.join(storage, "owned"), "12345");
  await writeFile(path.join(root, "outside"), "retain");
  await symlink(path.join(root, "outside"), path.join(storage, "linked"));
  expect(await inspectCleanupFile(storage, path.join(storage, "owned"))).toMatchObject({ size: 5 });
  await expect(inspectCleanupFile(storage, path.join(storage, "linked"))).rejects.toThrow("Linked files");
  await expect(inspectCleanupFile(storage, path.join(root, "outside"))).rejects.toThrow("outside");
  expect(await inspectCleanupFile(storage, path.join(storage, "missing"))).toBeNull();
});
it("rejects a linked ancestor even when the leaf itself is a regular file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "archive-cleanup-ancestor-"));
  temporary.push(root);
  await mkdir(path.join(root, "storage")); await mkdir(path.join(root, "outside"));
  await writeFile(path.join(root, "outside", "file"), "retain");
  await symlink(path.join(root, "outside"), path.join(root, "storage", "linked"));
  await expect(inspectCleanupFile(path.join(root, "storage"), path.join(root, "storage", "linked", "file"))).rejects.toThrow("Linked files");
});
