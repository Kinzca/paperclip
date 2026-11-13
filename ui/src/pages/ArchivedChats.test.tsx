// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArchivedChats } from "./ArchivedChats";

const api = vi.hoisted(() => ({ listArchivedChats: vi.fn(), listAllArchivedChats: vi.fn(), previewArchivedChatCleanupSelection: vi.fn(), deleteArchivedChat: vi.fn(), unarchiveFromInbox: vi.fn(), previewArchivedChatCleanup: vi.fn(), cleanupArchivedChats: vi.fn(), pendingArchiveCleanup: vi.fn(), retryArchiveCleanup: vi.fn() }));
vi.mock("@/api/issues", () => ({ issuesApi: api }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: "user-1" } }) } }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("@/lib/router", () => ({ Link: ({ children, to, ...props }: React.PropsWithChildren<{ to: string }>) => <a href={to} {...props}>{children}</a> }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const task = { id: "task-1", identifier: "DEMO-1", title: "Archived example", status: "done", projectId: null, updatedAt: "2026-11-10T12:00:00Z", archivedAt: "2026-11-10T12:00:00Z" };
beforeEach(async () => {
  vi.clearAllMocks();
  api.listArchivedChats.mockResolvedValue([task]);
  api.listAllArchivedChats.mockResolvedValue([task]);
  api.previewArchivedChatCleanupSelection.mockImplementation((...args) => api.previewArchivedChatCleanup(...args));
  api.pendingArchiveCleanup.mockResolvedValue([]);
  api.previewArchivedChatCleanup.mockResolvedValue({ previewOnly: true, skipRelated: true, truncated: false,
    items: [{ id: task.id, title: task.title, identifier: task.identifier, parentId: null, childCount: 0, linked: false, ownProtectionReason: null, protection: "candidate", reason: "Candidate only.", localAttachmentBytes: 1024, databaseRecordBytes: 2048, filePlan: { localBytes: 1024, files: [], retained: [] } }] });
  api.unarchiveFromInbox.mockResolvedValue({ ok: true });
  container = document.createElement("div"); document.body.append(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><ArchivedChats /></QueryClientProvider>));
  await vi.waitFor(() => expect(container.textContent).toContain(task.title));
  await vi.waitFor(() => expect(button("Select all chats").disabled).toBe(false));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
function button(text: string) {
  const found = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}

it("requires explicit confirmation, supports cancel, and keeps deletion failures visible", async () => {
  api.deleteArchivedChat.mockRejectedValue(new Error("This task has subtasks. Manage those tasks before deleting it."));
  const open = () => container.querySelector<HTMLButtonElement>('button[aria-label^="Delete archived chat:"]')!.click();
  await act(async () => open());
  expect(api.deleteArchivedChat).not.toHaveBeenCalled();
  await act(async () => button("Cancel").click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await act(async () => open());
  await vi.waitFor(() => expect(button("Delete permanently").disabled).toBe(false));
  await act(async () => button("Delete permanently").click());
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("subtasks"));
  expect(api.deleteArchivedChat).toHaveBeenCalledExactlyOnceWith("task-1");
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
});

it("unarchives without calling delete or a task-resume API", async () => {
  await act(async () => button("Unarchive").click());
  await vi.waitFor(() => expect(api.unarchiveFromInbox).toHaveBeenCalledExactlyOnceWith("task-1"));
  expect(api.deleteArchivedChat).not.toHaveBeenCalled();
});

it("previews selected chats with protection reasons and never submits a deletion", async () => {
  api.previewArchivedChatCleanup.mockResolvedValue({ previewOnly: true, truncated: false, measuredAt: new Date().toISOString(),
    items: [{ id: task.id, title: task.title, identifier: task.identifier, protection: "protected", reason: "This task has subtasks." }] });
  await act(async () => button("Select all chats").click());
  await act(async () => button("Delete selected chats...").click());
  await vi.waitFor(() => expect(api.previewArchivedChatCleanup).toHaveBeenLastCalledWith("company-1", { issueIds: [task.id], skipRelated: true }));
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("This task has subtasks.");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("This cannot be undone");
  expect(api.deleteArchivedChat).not.toHaveBeenCalled();
  expect(api.unarchiveFromInbox).not.toHaveBeenCalled();
});

it("shows space estimates and deletes candidates only after explicit confirmation", async () => {
  api.cleanupArchivedChats.mockResolvedValue({ items: [{ id: task.id, status: "deleted", reason: "Deleted.", fileCleanupFailed: false }], estimatedLocalBytesRemoved: 1024 });
  await act(async () => button("Select all chats").click());
  await act(async () => button("Delete selected chats...").click());
  await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("1 KB"));
  expect(api.cleanupArchivedChats).not.toHaveBeenCalled();
  await act(async () => button("Permanently delete 1 chats").click());
  await vi.waitFor(() => expect(api.cleanupArchivedChats).toHaveBeenCalledExactlyOnceWith("company-1", { issueIds: [task.id], skipRelated: true, confirm: true }));
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain("1 completed"));
  expect(api.deleteArchivedChat).not.toHaveBeenCalled();
});

it("keeps the selected records when changing the linked-task filter", async () => {
  await act(async () => button("Select all chats").click());
  const option = document.querySelector<HTMLButtonElement>('label button[role="checkbox"]')!;
  await act(async () => option.click());
  await vi.waitFor(() => expect(button("Delete selected chats...").disabled).toBe(false));
  await act(async () => button("Delete selected chats...").click());
  await vi.waitFor(() => expect(api.previewArchivedChatCleanup).toHaveBeenLastCalledWith("company-1", { issueIds: [task.id], skipRelated: false }));
  expect(api.cleanupArchivedChats).not.toHaveBeenCalled();
});

it("selects linked records when exclusion is disabled even when deletion is protected", async () => {
  const blocked = { ...task, id: "task-2", title: "Linked task" };
  api.listArchivedChats.mockResolvedValue([task, blocked]);
  api.listAllArchivedChats.mockResolvedValue([task, blocked]);
  api.previewArchivedChatCleanup.mockImplementation(async (_company, input) => ({ previewOnly: true, skipRelated: input.skipRelated,
    items: input.issueIds.map((id: string) => ({ id, title: id === task.id ? task.title : blocked.title,
      linked: id !== task.id, protection: id === task.id ? "candidate" : "protected", reason: "This task has subtasks.", databaseRecordBytes: 1,
      filePlan: { localBytes: 0, files: [], retained: [] } })) }));
  await act(async () => { await client.invalidateQueries({ queryKey: ["archived-chats"] }); });
  await vi.waitFor(() => expect(container.textContent).toContain("Linked task"));
  await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('button[aria-label="Select chat: Linked task"]')?.disabled).toBe(true));
  await vi.waitFor(() => expect(button("Select all chats").disabled).toBe(false));
  await act(async () => button("Select all chats").click());
  expect(container.textContent).toContain("Selected 1");
  await act(async () => document.querySelector<HTMLButtonElement>('label button[role="checkbox"]')!.click());
  await act(async () => button("Select all chats").click());
  await vi.waitFor(() => expect(container.textContent).toContain("Selected 2"));
  await act(async () => button("Delete selected chats...").click());
  await vi.waitFor(() => expect(api.previewArchivedChatCleanup).toHaveBeenLastCalledWith("company-1", { issueIds: [task.id, blocked.id], skipRelated: false }));
});

it("preserves confirmed deletions and stops later batches after an uncertain response", async () => {
  const tasks = Array.from({ length: 401 }, (_, index) => ({ ...task, id: `batch-${index}`, title: `Archived ${index}` }));
  api.listAllArchivedChats.mockResolvedValue(tasks);
  api.previewArchivedChatCleanup.mockImplementation(async (_company, input) => ({ previewOnly: true, skipRelated: true,
    items: input.issueIds.map((id: string) => ({ id, title: id, protection: "candidate", reason: "", filePlan: { localBytes: 0, files: [], retained: [] }, databaseRecordBytes: 0 })) }));
  api.cleanupArchivedChats.mockImplementationOnce(async (_company, input) => ({ items: input.issueIds.map((id: string) => ({ id, status: "deleted", reason: "Deleted.", fileCleanupFailed: false })), estimatedLocalBytesRemoved: 0 }))
    .mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => button("Select all chats").click());
  await vi.waitFor(() => expect(container.textContent).toContain("Selected 401"));
  await act(async () => button("Delete selected chats...").click());
  await vi.waitFor(() => expect(button("Permanently delete 401 chats").disabled).toBe(false));
  expect(api.cleanupArchivedChats).not.toHaveBeenCalled();
  await act(async () => button("Permanently delete 401 chats").click());
  await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("200 completed"));
  expect(api.cleanupArchivedChats).toHaveBeenCalledTimes(2);
  expect(api.cleanupArchivedChats.mock.calls.map(call => call[1].issueIds.length)).toEqual([200, 200]);
  expect(container.textContent).toContain("Selected 201");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Refresh before retrying");
});
