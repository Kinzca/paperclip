import { describe, expect, it, vi } from "vitest";
import { companies, type Db } from "@paperclipai/db";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { renderPaperclipWakePrompt } from "@paperclipai/adapter-utils/server-utils";
import { resolveSharedAgentInstructions } from "./shared-agent-instructions.js";

const general = vi.hoisted(() => ({ agentInstructions: "Use Chinese and cite sources." }));
vi.mock("./instance-settings.js", () => ({ instanceSettingsService: () => ({ getGeneral: async () => general }) }));

describe("shared agent instructions", () => {
  it("reads current settings per run, isolates organizations, and clears without retaining old guidance", async () => {
    const instructions = new Map([["studio-a", "Preserve game test evidence."], ["studio-b", "Mark fictional examples."]]);
    const where = vi.fn((condition: SQL) => {
      const companyId = new PgDialect().sqlToQuery(condition).params[0] as string;
      return Promise.resolve(instructions.has(companyId) ? [{ instructions: instructions.get(companyId)! }] : []);
    });
    const from = vi.fn(() => ({ where }));
    const db = { select: () => ({ from }) } as unknown as Db;
    const first = await resolveSharedAgentInstructions(db, "studio-a");
    expect(from).toHaveBeenCalledWith(companies);
    expect(first.text).toContain(general.agentInstructions);
    expect(first.text).toContain("Preserve game test evidence.");
    expect(first.text).not.toContain("Mark fictional examples.");
    expect((await resolveSharedAgentInstructions(db, "studio-b")).text).not.toContain("Preserve game test evidence.");
    general.agentInstructions = "Use the updated company terminology.";
    const next = await resolveSharedAgentInstructions(db, "studio-a");
    expect(next.sha256).not.toBe(first.sha256);
    expect(next.text).not.toContain("Use Chinese");
    expect(renderPaperclipWakePrompt({ sharedAgentInstructions: next.text }, { resumedSession: true })).toContain(general.agentInstructions);
    general.agentInstructions = "";
    instructions.set("studio-a", "");
    const cleared = await resolveSharedAgentInstructions(db, "studio-a");
    expect(cleared.text).toBe("");
    expect(cleared.sha256).not.toBe(next.sha256);
    expect(renderPaperclipWakePrompt({ sharedAgentInstructions: cleared.text })).toBe("");
    await expect(resolveSharedAgentInstructions(db, "unknown-studio")).rejects.toThrow("company not found");
  });
});
