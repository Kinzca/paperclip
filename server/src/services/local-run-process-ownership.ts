import { readProcessStartedAt } from "./hot-restart.js";

/** Read-only ownership probe. Missing identity or inaccessible processes retain the hold. */
export async function mayOwnLocalRunProcesses(run: {
  processPid: number | null;
  processGroupId: number | null;
  processStartedAt: Date | null;
}): Promise<boolean> {
  const mayBeAlive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  };
  let pidAlive = run.processPid !== null && mayBeAlive(run.processPid);
  if (pidAlive && run.processStartedAt) {
    const observed = await readProcessStartedAt(run.processPid!).catch(() => null);
    // Legacy capture can fall back to post-spawn wall time if OS identity was
    // unreadable. An earlier/coarser OS timestamp may still be that provider;
    // only a positively later start establishes a replacement generation.
    if (observed && new Date(observed).getTime() > run.processStartedAt.getTime()) {
      pidAlive = false;
      // POSIX reserves a group leader's PID until that process group ends.
      // Reuse of that PID proves the old same-numbered group also ended.
      // A missing leader, a different group ID, or unknown start time cannot
      // establish this: real children may still own the original group.
      if (process.platform !== "win32" && run.processGroupId === run.processPid) return false;
    }
  }
  const groupAlive = run.processGroupId !== null && mayBeAlive(-run.processGroupId);
  return pidAlive || groupAlive;
}
