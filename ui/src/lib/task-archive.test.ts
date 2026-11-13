import { beforeEach, expect, it, vi } from "vitest";
import { prepareTaskArchive, stopTaskForArchive, type TaskArchivePreparation } from "./task-archive";

const api = vi.hoisted(() => ({ get: vi.fn(), previewTreeControl: vi.fn(), createTreeHold: vi.fn(), run: vi.fn(), control: vi.fn(), cancel: vi.fn() }));
vi.mock("@/api/issues", () => ({ issuesApi: api }));
vi.mock("@/api/workflows", () => ({ workflowsApi: api }));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: api }));
const preparation = {
  task: { id: "root", conversationAgentId: null },
  tree: { issues: [{ id: "root", status: "in_progress" }, { id: "child", status: "blocked" }], activeRuns: [] },
  workflows: [{ id: "flow", issueId: "root", version: 3, status: "running" }],
} as unknown as TaskArchivePreparation;
beforeEach(() => { vi.resetAllMocks(); api.createTreeHold.mockResolvedValue({}); });

it("rejects a workflow outside the confirmed task scope without cancelling it", async () => {
  api.get.mockResolvedValue(preparation.task);
  api.previewTreeControl.mockResolvedValue(preparation.tree);
  api.run.mockResolvedValue({ id: "outer", issueId: "outside", status: "running" });
  await expect(prepareTaskArchive("root")).rejects.toThrow("outside this scope");
  expect(api.createTreeHold).not.toHaveBeenCalled();
  expect(api.control).not.toHaveBeenCalled();
});

it("uses confirmed membership and workflow version, then waits for terminal execution before returning", async () => {
  api.previewTreeControl.mockResolvedValue({ issues: [{ id: "root", status: "cancelled" }, { id: "child", status: "done" }], activeRuns: [] });
  api.run.mockResolvedValueOnce(preparation.workflows[0]).mockResolvedValue({ id: "flow", issueId: "root", status: "cancelled" });
  await stopTaskForArchive(preparation);
  expect(api.createTreeHold).toHaveBeenCalledWith("root", expect.objectContaining({ mode: "cancel", expectedIssueIds: ["root", "child"] }));
  expect(api.control).toHaveBeenCalledWith("root", expect.objectContaining({ action: "cancel", expectedVersion: 3 }));
});

it("does not report stopped when the native cancellation fails or the task scope expands", async () => {
  api.createTreeHold.mockRejectedValueOnce(new Error("native cancellation rejected"));
  await expect(stopTaskForArchive(preparation)).rejects.toThrow("native cancellation rejected");
  expect(api.control).not.toHaveBeenCalled();
  api.run.mockResolvedValue({ id: "flow", issueId: "root", status: "cancelled" });
  api.previewTreeControl.mockResolvedValue({ issues: [{ id: "root", status: "cancelled" }, { id: "child", status: "cancelled" }, { id: "new" }], activeRuns: [] });
  await expect(stopTaskForArchive(preparation)).rejects.toThrow("scope changed");
});

it("stops only the current persistent conversation reply without cancelling its child tasks", async () => {
  api.get.mockResolvedValue({ id: "root", conversationAgentId: "agent" });
  api.previewTreeControl.mockResolvedValueOnce({ issues: [{ id: "root", status: "in_progress" }, { id: "child", status: "in_progress" }],
    activeRuns: [{ id: "reply", issueId: "root" }, { id: "child-run", issueId: "child" }] })
    .mockResolvedValue({ issues: [{ id: "root", status: "in_progress" }, { id: "child", status: "in_progress" }], activeRuns: [{ id: "child-run", issueId: "child" }] });
  api.run.mockResolvedValue(null);
  const scope = await prepareTaskArchive("root");
  await stopTaskForArchive(scope);
  expect(scope.tree.issues.map(issue => issue.id)).toEqual(["root"]);
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith("reply");
  expect(api.createTreeHold).not.toHaveBeenCalled();
});
