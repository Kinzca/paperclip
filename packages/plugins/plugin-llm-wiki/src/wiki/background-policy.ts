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
export function selectSources(pieces: SourcePiece[], maxCharacters: number) {
  const unique = new Map<string, SourcePiece>();
  for (const piece of pieces) {
    if (!meaningful(piece.body)) continue;
    const key = normalized(piece.body);
    if (!unique.has(key)) unique.set(key, piece);
  }
  const selected = [...unique].sort(([a], [b]) => a.localeCompare(b));
  const fingerprint = hash(JSON.stringify(selected.map(([body]) => body)));
  let used = 0;
  const bounded: SourcePiece[] = [];
  let clipped = false;
  for (const [, piece] of selected) {
    const cost = piece.body.length + piece.reference.length + 32;
    if (used + cost > maxCharacters) { clipped = true; continue; }
    bounded.push(piece); used += cost;
  }
  return { fingerprint, pieces: bounded, clipped, meaningful: bounded.length > 0 };
}
