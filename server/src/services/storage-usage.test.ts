import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { measureStorageUsage } from "./storage-usage.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

it("counts nested categories once and skips links outside the inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "paperclip-outside-"));
  temporary.push(root, outside);
  await mkdir(path.join(root, "logs"));
  await writeFile(path.join(root, "logs", "run.log"), "12345");
  await writeFile(path.join(root, "config.json"), "{}");
  await writeFile(path.join(outside, "private"), "do not count this");
  await symlink(outside, path.join(root, "linked"), "dir");
  const usage = await measureStorageUsage([{ path: root, category: "other" }, { path: path.join(root, "logs"), category: "logs" }], root);
  expect(usage).toMatchObject({ totalBytes: 7, complete: true, filesScanned: 2 });
  expect(usage.categories.find((item) => item.key === "logs")?.bytes).toBe(5);
});

it("marks bounded inventories partial rather than presenting a complete total", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-storage-limit-"));
  temporary.push(root);
  await writeFile(path.join(root, "file"), "bytes");
  const usage = await measureStorageUsage([{ path: root, category: "other" }], root, { maxEntries: 1, maxMs: 3000 });
  expect(usage.complete).toBe(false);
});

it("includes external projects without counting nested or duplicate roots twice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-project-total-"));
  temporary.push(root);
  const instance = path.join(root, "instance");
  const inside = path.join(instance, "project");
  const external = path.join(root, "external");
  const knowledge = path.join(external, "knowledge");
  await mkdir(inside, { recursive: true });
  await mkdir(knowledge, { recursive: true });
  await writeFile(path.join(instance, "config"), "12");
  await writeFile(path.join(inside, "source"), "123");
  await writeFile(path.join(external, "asset"), "12345");
  await writeFile(path.join(knowledge, "wiki"), "1234567");
  const usage = await measureStorageUsage([
    { path: instance, category: "other" },
    ...[inside, external, knowledge, external].map((directory) => ({ path: directory, category: "companyProjects" as const })),
  ], instance);
  expect(usage).toMatchObject({ totalBytes: 17, complete: true, filesScanned: 4, projectRootCount: 3 });
  expect(usage.categories.find((item) => item.key === "companyProjects")?.bytes).toBe(15);
});
