import { expect, it, vi } from "vitest";
import { issuesApi } from "./issues";

const transport = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("./client", () => ({ api: transport }));

it("keeps selected descendants before their parent across preview request boundaries without expanding the selection", async () => {
  const ids = ["parent", ...Array.from({ length: 201 }, (_, index) => `child-${index}`)];
  transport.post.mockImplementation(async (_path, input) => ({ previewOnly: true, skipRelated: false, measuredAt: "now", truncated: false,
    items: input.issueIds.map((id: string) => ({ id, title: id, identifier: null, parentId: id === "parent" ? null : "parent",
      childCount: id === "parent" ? 201 : 0, linked: true, ownProtectionReason: null,
      protection: id === "parent" ? "protected" : "candidate", reason: "", localAttachmentBytes: 0, databaseRecordBytes: 0,
      filePlan: { files: [], retained: [], localBytes: 0 } })) }));
  const result = await issuesApi.previewArchivedChatCleanupSelection("company", { issueIds: ids, skipRelated: false });
  expect(transport.post.mock.calls.map(call => call[1].issueIds.length)).toEqual([200, 2]);
  expect(result.items.at(-1)?.id).toBe("parent");
  expect(result.items.every(item => item.protection === "candidate")).toBe(true);
  expect(new Set(result.items.map(item => item.id))).toEqual(new Set(ids));
  transport.post.mockClear();
  const incomplete = await issuesApi.previewArchivedChatCleanupSelection("company", { issueIds: ["parent", "child-0"], skipRelated: false });
  expect(incomplete.items.find(item => item.id === "parent")?.protection).toBe("protected");
});
