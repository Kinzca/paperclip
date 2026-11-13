// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxArchiveButton } from "./IssueRow";
const control = vi.hoisted(() => ({ prepareTaskArchive: vi.fn(), stopTaskForArchive: vi.fn() }));
vi.mock("@/lib/task-archive", () => control);
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const archive = vi.fn();
beforeEach(async () => {
  vi.resetAllMocks();
  control.prepareTaskArchive.mockResolvedValue({ tree: { issues: [{ id: "root" }] } });
  control.stopTaskForArchive.mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<div data-archive-scope><InboxArchiveButton issueId="root" onArchive={archive} /></div>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = () => container.querySelector("button")!;
const leave = () => container.querySelector("[data-archive-scope]")!.dispatchEvent(new Event("pointerleave"));

it("requires inline confirmation and resets when leaving the row before confirmation", async () => {
  await act(async () => button().click());
  expect(button().textContent).toContain("Confirm archive");
  expect(control.stopTaskForArchive).not.toHaveBeenCalled();
  expect(archive).not.toHaveBeenCalled();
  await act(async () => leave());
  expect(button().textContent).toContain("Archive");
  await act(async () => button().click());
  expect(control.stopTaskForArchive).not.toHaveBeenCalled();
});

it("does not archive on cancellation failure", async () => {
  control.stopTaskForArchive.mockRejectedValue(new Error("stop failed"));
  await act(async () => button().click());
  await act(async () => button().click());
  expect(archive).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("stop failed");
});

it("keeps a confirmed stop running after pointer leave and archives only after it finishes", async () => {
  let finish!: () => void;
  control.stopTaskForArchive.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => button().click());
  await act(async () => button().click());
  await act(async () => leave());
  expect(button().textContent).toContain("Stopping");
  expect(archive).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(archive).toHaveBeenCalledTimes(1);
});
