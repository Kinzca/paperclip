import { describe, expect, it } from "vitest";
import { updateCompanySchema, updateCompanyBrandingSchema } from "./company.js";
import { patchInstanceGeneralSettingsSchema } from "./instance.js";

describe("shared instruction configuration boundary", () => {
  it.each([patchInstanceGeneralSettingsSchema, updateCompanySchema])("accepts clearing and rejects malformed or oversized guidance", schema => {
    expect(schema.parse({ agentInstructions: "" })).toMatchObject({ agentInstructions: "" });
    expect(schema.parse({ agentInstructions: "# Guidance\nUse Chinese." })).toMatchObject({ agentInstructions: "# Guidance\nUse Chinese." });
    for (const value of [null, 12, {}, "x".repeat(32001)]) expect(schema.safeParse({ agentInstructions: value }).success).toBe(false);
  });
  it("does not let agent-authorized branding edits change organization instructions", () => {
    expect(updateCompanyBrandingSchema.safeParse({ name: "Studio", agentInstructions: "Replace operator rules" }).success).toBe(false);
  });
});
