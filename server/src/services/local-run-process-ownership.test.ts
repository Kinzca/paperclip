import { afterEach, describe, expect, it, vi } from "vitest";
import { readProcessStartedAt } from "./hot-restart.js";
import { mayOwnLocalRunProcesses } from "./local-run-process-ownership.js";

vi.mock("./hot-restart.js", () => ({ readProcessStartedAt: vi.fn() }));

describe("local run process ownership", () => {
  const original = new Date("2026-01-01T00:00:00Z");
  const run = { processPid: 12345, processGroupId: 12345, processStartedAt: original };
  afterEach(() => vi.restoreAllMocks());

  it.skipIf(process.platform === "win32")("ignores a reused leader PID and PGID without signalling the replacement", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    vi.mocked(readProcessStartedAt).mockResolvedValue("2026-01-02T00:00:00Z");
    expect(await mayOwnLocalRunProcesses(run)).toBe(false);
    expect(kill.mock.calls).toEqual([[12345, 0]]);
  });

  it("retains a live matching provider", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    vi.mocked(readProcessStartedAt).mockResolvedValue(original.toISOString());
    expect(await mayOwnLocalRunProcesses(run)).toBe(true);
    expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  });

  it.each([0, 86_400_000])("retains an earlier OS identity instead of mistaking fallback wall time for reuse (%s)", async offset => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    vi.mocked(readProcessStartedAt).mockResolvedValue(new Date(original.getTime() - offset).toISOString());
    expect(await mayOwnLocalRunProcesses({ ...run, processStartedAt: new Date(original.getTime() + 500) })).toBe(true);
  });

  it("retains surviving children when their leader has exited", async () => {
    vi.spyOn(process, "kill").mockImplementation(pid => {
      if (pid > 0) throw Object.assign(new Error("gone"), { code: "ESRCH" });
      return true;
    });
    expect(await mayOwnLocalRunProcesses(run)).toBe(true);
  });

  it("does not use PID reuse to dismiss a different recorded process group", async () => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    vi.mocked(readProcessStartedAt).mockResolvedValue("2026-01-02T00:00:00Z");
    expect(await mayOwnLocalRunProcesses({ ...run, processGroupId: 23456 })).toBe(true);
  });

  it.each([null, "unreadable"])("retains a hold when the observed identity is %s", async observed => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    if (observed === "unreadable") vi.mocked(readProcessStartedAt).mockRejectedValue(new Error("unreadable"));
    else vi.mocked(readProcessStartedAt).mockResolvedValue(null);
    expect(await mayOwnLocalRunProcesses(run)).toBe(true);
  });

  it("retains a hold without a recorded start identity", async () => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    expect(await mayOwnLocalRunProcesses({ ...run, processStartedAt: null })).toBe(true);
  });

  it("retains ownership on permission errors", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    vi.mocked(readProcessStartedAt).mockRejectedValue(new Error("denied"));
    expect(await mayOwnLocalRunProcesses(run)).toBe(true);
  });

  it("releases a hold after both process and group are absent", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
    expect(await mayOwnLocalRunProcesses(run)).toBe(false);
  });
});
