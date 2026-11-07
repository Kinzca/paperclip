import { describe, expect, it } from "vitest";
import { BUILT_IN_WORKFLOW_TEMPLATES } from "@paperclipai/shared";
import {
  parseWorkflowDraft,
  savedWorkflowChoice,
  workflowChoices,
  workflowDraftFromPolicy,
  workflowStages,
} from "./workflow-presentation";
import type { WorkflowConfiguration } from "@/api/workflows";

describe("workflow presentation", () => {
  it("expresses parallel reviews and the acceptance join without relying on node order", () => {
    const game = BUILT_IN_WORKFLOW_TEMPLATES.find(
      (item) => item.key === "game-development",
    )!;
    const stages = workflowStages({
      ...game,
      nodes: [...game.nodes].reverse(),
    });
    expect(stages.map((stage) => stage.map((node) => node.id).sort())).toEqual([
      ["execute"],
      ["evidence"],
      ["code-review", "playtest"],
      ["accept"],
    ]);
  });
  it("converts dollar amounts to integer cents and preserves a pinned revision", () => {
    const draft = workflowDraftFromPolicy({
      templateKey: "game-development",
      revision: 2,
      limits: { maxCostCents: 29 },
    });
    expect(draft.maxCostCents).toBe("0.29");
    expect(parseWorkflowDraft(draft).policy).toEqual({
      templateKey: "game-development",
      revision: 2,
      limits: { maxCostCents: 29 },
    });
  });
  it.each(["0", "11", "1.5", "Infinity", "abc"])(
    "rejects invalid per-stage attempts: %s",
    (maxAttempts) => {
      const result = parseWorkflowDraft({
        ...workflowDraftFromPolicy(),
        maxAttempts,
      });
      expect(result.policy).toBeNull();
      expect(result.errors.maxAttempts).toBeTruthy();
    },
  );
  it.each(["0", "0.001", "10000.01", "-1", "1e2"])(
    "rejects invalid dollar amounts: %s",
    (maxCostCents) => {
      expect(
        parseWorkflowDraft({ ...workflowDraftFromPolicy(), maxCostCents })
          .errors.maxCostCents,
      ).toBeTruthy();
    },
  );
  it("retains empty overrides as inheritance", () => {
    expect(parseWorkflowDraft(workflowDraftFromPolicy()).policy).toEqual({
      limits: {},
    });
  });
  it("selects the latest available revision while honoring an explicit old pin", () => {
    const config = {
      builtIn: [...BUILT_IN_WORKFLOW_TEMPLATES],
      policies: [],
      platform: { version: 1, policy: {} },
      revisions: [
        {
          id: "revision-3",
          companyId: "company-1",
          basedOnRevisionId: null,
          rationale: "",
          createdByUserId: null,
          createdByAgentId: null,
          publishedAt: null,
          createdAt: "2026-11-03T00:00:00Z",
          templateKey: "standard",
          revision: 3,
          status: "published",
          definition: { ...BUILT_IN_WORKFLOW_TEMPLATES[0], name: "Newest" },
        },
        {
          id: "revision-2",
          companyId: "company-1",
          basedOnRevisionId: null,
          rationale: "",
          createdByUserId: null,
          createdByAgentId: null,
          publishedAt: null,
          createdAt: "2026-11-03T00:00:00Z",
          templateKey: "standard",
          revision: 2,
          status: "published",
          definition: { ...BUILT_IN_WORKFLOW_TEMPLATES[0], name: "Pinned" },
        },
      ],
    } as WorkflowConfiguration;
    expect(workflowChoices(config)[0].definition.name).toBe("Newest");
    expect(
      savedWorkflowChoice(config, { templateKey: "standard", revision: 2 })
        ?.definition.name,
    ).toBe("Pinned");
    expect(
      savedWorkflowChoice(config, { templateKey: "standard", revision: 7 }),
    ).toBeUndefined();
  });
});

it("round trips explicit unlimited time separately from omitted inheritance", () => {
  const draft = workflowDraftFromPolicy({ limits: { timeoutMinutes: null } });
  expect(draft.timeoutMinutes).toBe("unlimited");
  expect(parseWorkflowDraft(draft).policy?.limits?.timeoutMinutes).toBeNull();
  expect(parseWorkflowDraft(workflowDraftFromPolicy()).policy?.limits).toEqual({});
});
