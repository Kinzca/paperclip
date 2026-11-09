import fs from "node:fs";
import { execFileSync } from "node:child_process";

/** A liveness probe is not ownership. Unknown identity fails closed. */
export function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid service PID");
  try { process.kill(pid, 0); } catch (error) {
    if (error.code === "ESRCH") return null;
    throw error;
  }
  if (process.platform === "darwin") {
    const value = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="], {
      encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    }).trim();
    if (!value) throw new Error("Cannot verify process birth and command");
    return value;
  }
  if (process.platform === "linux") {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return `${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}:${fs.readFileSync(`/proc/${pid}/cmdline`, "utf8")}`;
  }
  if (process.platform === "win32") {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (!$p) { exit 1 }; $p.CreationDate.ToUniversalTime().ToString('o'); $p.CommandLine`],
      { encoding: "utf8", timeout: 10000 }).trim();
  }
  throw new Error("Service process identity is not supported on this platform");
}
