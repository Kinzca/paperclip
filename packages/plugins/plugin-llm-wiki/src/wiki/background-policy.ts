import { createHash } from "node:crypto";

export const BACKGROUND_JOB_KEY = "wiki-background-batches";
export type BackgroundPolicy = {
  enabled: boolean;
  waitForBusinessIdle: boolean;
  projectIds: string[];
  enabledAt: string;
  quietMinutes: number;
  maxRootsPerBatch: number;
  maxCharacters: number;
  maxRunsPerDay: number;
  maintenanceHour: number;
  timezone: string;
};
export const DEFAULT_BACKGROUND_POLICY: BackgroundPolicy = {
  enabled: false, waitForBusinessIdle: true, projectIds: [], enabledAt: "",
  quietMinutes: 5, maxRootsPerBatch: 3, maxCharacters: 24000,
  maxRunsPerDay: 6, maintenanceHour: 3, timezone: "Asia/Shanghai",
};
export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function normalized(value: string): string {
  return value.replace(/^(?:updated_at|updated at|last modified|更新时间)\s*[:：].*$/gmi, "")
    .replace(/\s+/g, " ").trim();
}
export function meaningful(value: string): boolean {
  const text = normalized(value);
  if (text.length < 45 || /知识沉淀\s*[:：]\s*(?:无需|跳过)/.test(text)) return false;
  if (/-----BEGIN .*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{25,}/.test(text)) return false;
  return /决策|结论|验收|验证|根因|解决方法|需求|约定|权衡|修复|复盘|decision|verified|validation|root cause|requirement|trade.?off/i.test(text);
}
export function isBusinessRoot(issue: {
  parentId?: string | null; projectId?: string | null; status: string;
  originKind?: string | null; completedAt?: unknown;
}, policy: BackgroundPolicy): boolean {
  return policy.enabled && !issue.parentId && issue.status === "done" &&
    Boolean(issue.projectId && policy.projectIds.includes(issue.projectId)) &&
    !issue.originKind?.startsWith("plugin:") &&
    Date.parse(String(issue.completedAt ?? "")) >= Date.parse(policy.enabledAt);
}
export function clock(now: Date, timezone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return { day: part("year") + "-" + part("month") + "-" + part("day"), hour: Number(part("hour")) };
}
export function normalizePolicy(input: unknown, previous: BackgroundPolicy, now: Date): BackgroundPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Background policy must be an object");
  const value = input as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_BACKGROUND_POLICY).filter(k => k !== "enabledAt");
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error("Unknown background policy field");
  if ("enabled" in value && typeof value.enabled !== "boolean") throw new Error("enabled must be boolean");
  if ("waitForBusinessIdle" in value && typeof value.waitForBusinessIdle !== "boolean") throw new Error("waitForBusinessIdle must be boolean");
  const policy = { ...previous, ...value } as BackgroundPolicy;
  if (!Array.isArray(policy.projectIds) || policy.projectIds.length > 25 ||
      !policy.projectIds.every(id => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error("Select at most 25 explicit project IDs");
  }
  policy.projectIds = [...new Set(policy.projectIds)];
  if (policy.enabled && !policy.projectIds.length) throw new Error("Background ingestion requires selected projects");
  for (const [key, min, max] of [
    ["quietMinutes", 1, 60], ["maxRootsPerBatch", 1, 5], ["maxCharacters", 1000, 60000],
    ["maxRunsPerDay", 1, 24], ["maintenanceHour", 0, 23],
  ] as const) {
    if (!Number.isInteger(policy[key]) || policy[key] < min || policy[key] > max) throw new Error("Invalid " + key);
  }
  if (typeof policy.timezone !== "string") throw new Error("timezone must be a string");
  clock(now, policy.timezone);
  policy.enabledAt = policy.enabled && !previous.enabled ? now.toISOString() : previous.enabledAt;
  return policy;
}
export type SourcePiece = { reference: string; body: string };
export type SourceCursor = { version: string; piece: number; offset: number };
export function selectSources(pieces: SourcePiece[], maxCharacters: number, cursor?: SourceCursor) {
  const unique = new Map<string, SourcePiece>();
  for (const piece of pieces) {
    if (!meaningful(piece.body)) continue;
    const key = normalized(piece.body);
    if (!unique.has(key)) unique.set(key, piece);
  }
  const selected = [...unique].sort(([a], [b]) => a.localeCompare(b));
  const fingerprint = hash(JSON.stringify(selected.map(([body]) => body)));
  // Cursor offsets address the original text, including formatting. Whitespace-only
  // changes must restart a partial source rather than shift an existing offset.
  const version = hash(JSON.stringify(selected.map(([, piece]) => piece)));
  let pieceIndex = cursor?.version === version ? cursor.piece : 0;
  let offset = cursor?.version === version ? cursor.offset : 0;
  const start = { piece: pieceIndex, offset };
  let used = 0;
  const bounded: SourcePiece[] = [];
  while (pieceIndex < selected.length) {
    const piece = selected[pieceIndex]![1];
    // Reserve space for a continuation label and source heading.
    const room = maxCharacters - used - piece.reference.length - 128;
    if (room < 2) break;
    let end = Math.min(piece.body.length, offset + room);
    if (end < piece.body.length && /[\uD800-\uDBFF]/.test(piece.body[end - 1]!)) end--;
    const reference = offset || end < piece.body.length
      ? `${piece.reference} (characters ${offset + 1}-${end} of ${piece.body.length})`
      : piece.reference;
    const body = piece.body.slice(offset, end);
    bounded.push({ reference, body });
    used += body.length + reference.length + 32;
    if (end < piece.body.length) { offset = end; break; }
    pieceIndex++; offset = 0;
  }
  const complete = pieceIndex === selected.length;
  return { fingerprint, pieces: bounded, clipped: !complete, meaningful: selected.length > 0,
    window: { start, next: { version, piece: pieceIndex, offset }, complete } };
}
