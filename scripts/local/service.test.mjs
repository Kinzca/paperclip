import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { processIdentity, appendServiceLog, readServiceHealth } from "./service.mjs";

test("local service ownership includes birth and command, not just a reused PID", { skip: !["darwin", "linux"].includes(process.platform) }, () => {
  const identity = processIdentity(process.pid);
  assert.ok(identity.includes("node"));
  assert.equal(identity, processIdentity(process.pid));
  assert.throws(() => processIdentity(-1), /Invalid/);
  assert.throws(() => processIdentity("123"), /Invalid/);
});
test("bounds service logs to the current file and one rotation", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-log-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "service.log");
  for (let n = 0; n < 20; n++) appendServiceLog(log, Buffer.alloc(80, n), 128);
  assert.ok(fs.statSync(log).size <= 128);
  assert.ok(fs.statSync(log + ".previous").size <= 128);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["service.log", "service.log.previous"]);
});
test("does not equate a live supervisor with a healthy application", async () => {
  assert.equal((await readServiceHealth("http://127.0.0.1:1", async () => { throw new Error("offline"); })).running, false);
  assert.equal((await readServiceHealth("http://127.0.0.1:1", async () => new Response("{}"))).running, false);
  assert.deepEqual(await readServiceHealth("http://127.0.0.1:1", async () => new Response(JSON.stringify({ status: "ok", commit: "a".repeat(40) }))),
    { running: true, serviceHealth: "ready", commit: "a".repeat(40) });
});
