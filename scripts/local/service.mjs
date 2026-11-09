import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localDir, env, port } from "./common.mjs";
import { lock, assertNode } from "./release-lib.mjs";
import { processIdentity } from "./process-identity.mjs";
export { processIdentity } from "./process-identity.mjs";

const statePath = path.join(localDir, "service.json");
export function appendServiceLog(file, chunk, maxBytes = 8 * 1024 * 1024) {
  const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (fs.existsSync(file) && fs.statSync(file).size + data.length > maxBytes) {
    fs.rmSync(file + ".previous", { force: true });
    fs.renameSync(file, file + ".previous");
  }
  fs.appendFileSync(file, data.subarray(Math.max(0, data.length - maxBytes)), { mode: 0o600 });
}
function state() { return fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null; }
function ownState() {
  const saved = state();
  if (!saved) return null;
  return saved.identity === processIdentity(saved.pid) ? saved : null;
}

export async function readServiceHealth(url, fetcher = fetch) {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    if (!response.ok || !body || typeof body !== "object" || body.status !== "ok" || typeof body.commit !== "string")
      throw new Error("The service has not reported a healthy build");
    return { running: true, serviceHealth: "ready", commit: body.commit };
  } catch (error) {
    return { running: false, serviceHealth: "unavailable", error: error.message };
  }
}

export async function service(action) {
  if (action === "start" || action === "supervise") assertNode();
  if ((action === "start" || action === "status") && (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535))
    throw new Error("PAPERCLIP_PORT must be an integer from 1 to 65535");
  if (action === "status") return { ...await readServiceHealth(`http://127.0.0.1:${port}/api/health`),
    supervisorRunning: !!ownState(), state: state() };
  if (action === "stop") {
    const owner = ownState();
    if (!owner) return { stopped: true, signalled: false };
    process.kill(owner.pid, "SIGTERM");
    return { stopping: true, pid: owner.pid };
  }
  if (action === "start") {
    const owner = ownState();
    if (owner) return { supervisorRunning: true, pid: owner.pid };
    const health = await readServiceHealth(`http://127.0.0.1:${port}/api/health`);
    if (health.running) return { ...health, supervisorRunning: false, existingHttpService: true };
    fs.mkdirSync(localDir, { recursive: true });
    const log = fs.openSync(path.join(localDir, "service-supervisor.log"), "a", 0o600);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "supervise"], {
      detached: true, stdio: ["ignore", log, log], env,
    });
    fs.closeSync(log);
    child.unref();
    return { starting: true, pid: child.pid, log: path.join(localDir, "service.log") };
  }
  if (action !== "supervise") throw new Error("Usage: node scripts/local/service.mjs start|stop|status");
  fs.mkdirSync(localDir, { recursive: true });
  const identity = processIdentity(process.pid);
  const unlock = lock(localDir);
  try {
    if (ownState()) throw new Error("The local supervisor already owns this instance");
    if (state()) fs.unlinkSync(statePath);
    fs.writeFileSync(statePath, JSON.stringify({ pid: process.pid, identity, startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  } finally { unlock(); }
  let stopping = false;
  let child;
  let wake;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    stopping = true;
    wake?.();
    // Only the direct child created by this supervisor receives the signal.
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
  });
  const awake = process.platform === "darwin" ? spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" }) : null;
  let failures = 0;
  try {
    while (!stopping && failures < 3) {
      const started = Date.now();
      child = spawn(process.execPath, [fileURLToPath(new URL("./start.mjs", import.meta.url))], { env, stdio: ["ignore", "pipe", "pipe"] });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => appendServiceLog(path.join(localDir, "service.log"), chunk));
      const result = await new Promise(resolve => {
        child.once("error", error => resolve({ error: error.message }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      console.log(JSON.stringify({ event: "local_service_exit", at: new Date().toISOString(), ...result }));
      if (stopping) break;
      failures = Date.now() - started >= 60000 ? 1 : failures + 1;
      if (failures < 3) await new Promise(resolve => {
        const timer = setTimeout(resolve, failures * 5000);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
    if (!stopping) throw new Error("Local service repeatedly failed; preserved data and stopped automatic restart. Inspect service.log");
  } finally {
    awake?.kill();
    const saved = state();
    if (saved?.pid === process.pid && saved.identity === identity) fs.unlinkSync(statePath);
  }
  return { stopped: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await service(process.argv[2]), null, 2));
}
