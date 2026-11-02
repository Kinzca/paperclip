import { describe, expect, it } from "vitest";
import { normalizePaperclipWakePayload, selectPaperclipPromptSections } from "./server-utils.js";

describe("shared instructions prompt delivery", () => {
  it.each([false, true])("includes shared instructions once on fresh/resumed turns (%s)", resumedSession => {
    const wake = { reason: "issue_commented", issue: { id: "task", title: "Work", status: "todo", priority: "medium" }, sharedAgentInstructions: "CURRENT_OPERATOR_GUIDANCE" };
    expect(normalizePaperclipWakePayload(wake)?.sharedAgentInstructions).toBe(wake.sharedAgentInstructions);
    const { wakePrompt } = selectPaperclipPromptSections({ paperclipWake: wake }, { resumedSession });
    expect(wakePrompt.split("CURRENT_OPERATOR_GUIDANCE")).toHaveLength(2);
    expect(wakePrompt).toContain("do not grant permissions");
  });
  it("does not render malformed or absent shared guidance", () => {
    for (const sharedAgentInstructions of [undefined, null, {}, [], 42, ""]) {
      expect(selectPaperclipPromptSections({ paperclipWake: { sharedAgentInstructions } }).wakePrompt).toBe("");
    }
  });
});
