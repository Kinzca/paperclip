import type { ArchivedChatCleanupPreview } from "./types/cleanup-preview.js";

type Item = ArchivedChatCleanupPreview["items"][number];

/** Resolve only the explicitly selected records, in child-before-parent order.
 * Missing, unreadable or protected descendants keep their parent protected.
 * Actual deletion still locks and rechecks every task in its own transaction.
 */
export function resolveArchivedChatCleanupSelection<T extends Omit<Item, "filePlan">>(items: T[], skipRelated: boolean): T[] {
  const children = new Map<string, T[]>();
  for (const item of items) {
    if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  }
  const resolved = new Map<string, T>();
  const visiting = new Set<string>();
  function visit(item: T): T {
    const previous = resolved.get(item.id);
    if (previous) return previous;
    if (visiting.has(item.id)) return { ...item, protection: "protected", reason: "This task has an invalid subtask cycle." };
    visiting.add(item.id);
    const selectedChildren = children.get(item.id) ?? [];
    const descendants = selectedChildren.map(visit);
    const reason = item.ownProtectionReason
      ?? (skipRelated && item.linked ? "This task has a parent, subtask, dependency or task reference." : null)
      ?? (selectedChildren.length !== item.childCount || descendants.some(child => child.protection !== "candidate")
        ? "Select all subtasks and finish or cancel them before deleting this task." : null);
    const result = { ...item, protection: reason ? "protected" as const : "candidate" as const,
      reason: reason ?? "Candidate only. Deletion must recheck current state and other references." };
    visiting.delete(item.id);
    resolved.set(item.id, result);
    return result;
  }
  for (const item of items) visit(item);
  return [...resolved.values()];
}
