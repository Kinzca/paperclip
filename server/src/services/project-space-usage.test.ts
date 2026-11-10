import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { scanProjectDirectory } from "./project-space-usage.js";

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

it("keeps source protected, treats caches as review-only and skips linked content", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "paperclip-project-space-")));
  folders.push(root);
  await mkdir(path.join(root, "src")); await writeFile(path.join(root, "src", "game.ts"), "source");
  await mkdir(path.join(root, "cache")); await writeFile(path.join(root, "cache", "item"), "123");
  await symlink(path.join(root, "src"), path.join(root, "linked"));
  const result = await scanProjectDirectory(root, false, false);
  expect(result.bytes).toBe(9);
  expect(result.status).toBe("measured");
  expect(result.directories.find((row) => row.name === "src")?.protection).toBe("protected");
  expect(result.directories.find((row) => row.name === "cache")?.protection).toBe("rebuildable");
  expect(result.directories.some((row) => row.protection === "candidate")).toBe(false);
  const shared = await scanProjectDirectory(root, true, false);
  expect(shared.directories.every((row) => row.protection === "protected")).toBe(true);
  const active = await scanProjectDirectory(root, false, true);
  expect(active.directories.every((row) => row.protection === "protected")).toBe(true);
});

it("marks missing paths and bounded scans rather than claiming complete zero usage", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "paperclip-project-partial-")));
  folders.push(root);
  await writeFile(path.join(root, "file"), "123");
  expect((await scanProjectDirectory(path.join(root, "missing"), false, false)).status).toBe("missing");
  expect((await scanProjectDirectory(root, false, false, { maxEntries: 1, maxMs: 3000 })).status).toBe("partial");
});
