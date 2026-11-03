// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_WORKFLOW_TEMPLATES } from "@paperclipai/shared";
import { Workflows } from "./Workflows";
import { ApiError } from "@/api/client";
import { setUiLocale, uiText } from "@/i18n/ui";
import type { WorkflowConfiguration } from "@/api/workflows";

const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  policy: vi.fn(),
  propose: vi.fn(),
  evaluations: vi.fn(),
  baselines: vi.fn(),
  trials: vi.fn(),
  publish: vi.fn(),
  evaluate: vi.fn(),
  projects: vi.fn(),
  breadcrumbs: vi.fn(),
}));
vi.mock("@/api/workflows", () => ({ workflowsApi: mocks }));
const selection = vi.hoisted(() => ({
  companyId: "company-1",
  userId: "user-1",
  failed: false,
}));
vi.mock("@/api/projects", () => ({ projectsApi: { list: mocks.projects } }));
vi.mock("@/api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: selection.userId,
    settled: !selection.failed,
    failed: selection.failed,
  }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: selection.companyId }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }),
}));
vi.mock("@/lib/router", async () => await import("react-router-dom"));

let config: WorkflowConfiguration;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
function click(text: string) {
  flushSync(() => {
    const target = button(text);
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    target.click();
  });
}
function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  flushSync(() => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function submit() {
  flushSync(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function render() {
  flushSync(() =>
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Workflows />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  );
  await vi.waitFor(() =>
    expect(container.textContent).toContain(uiText("Available workflows")),
  );
}
function draftRevision() {
  return {
    id: "revision-1",
    companyId: "company-1",
    templateKey: "game-development",
    revision: 2,
    status: "draft" as const,
    definition: structuredClone(
      BUILT_IN_WORKFLOW_TEMPLATES.find(
        (item) => item.key === "game-development",
      )!,
    ),
    basedOnRevisionId: null,
    rationale: "Improve execution",
    createdByUserId: "user-1",
    createdByAgentId: null,
    publishedAt: null,
    createdAt: "2026-11-03T00:00:00Z",
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  selection.companyId = "company-1";
  selection.userId = "user-1";
  selection.failed = false;
  await setUiLocale("en");
  config = {
    platform: { version: 1, policy: {} },
    builtIn: structuredClone([...BUILT_IN_WORKFLOW_TEMPLATES]),
    revisions: [],
    policies: [
      {
        id: "policy-1",
        companyId: "company-1",
        scope: "company",
        projectId: null,
        version: 1,
        policy: { templateKey: "game-development" },
      },
    ],
  };
  mocks.configuration.mockImplementation(async () => structuredClone(config));
  mocks.projects.mockResolvedValue([{ id: "project-1", name: "Game" }]);
  mocks.evaluations.mockResolvedValue([]);
  mocks.baselines.mockResolvedValue({ items: [], hasMore: false });
  mocks.policy.mockImplementation(async (_companyId, input) => {
    config.policies[0] = {
      ...config.policies[0],
      version: 2,
      policy: input.policy,
    };
    return config.policies[0];
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  flushSync(() => root.unmount());
  client.clear();
  container.remove();
});

describe("workflow settings experience", () => {
  it("localizes built-in workflow content, displays the parallel branch and keeps controls behind Edit", async () => {
    await setUiLocale("zh-CN");
    await render();
    expect(container.textContent).toContain("游戏开发");
    expect(container.textContent).toContain("并行执行");
    expect(container.textContent).toContain("等待：代码审查 · 试玩验证");
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(container.textContent).not.toContain("game-development");
  });
  it("validates fields locally, saves integer cents, and confirms next to the overview", async () => {
    await render();
    click("Edit rules");
    const attempts = container.querySelector<HTMLInputElement>(
      "#workflow-maxAttempts",
    )!;
    input(attempts, "11");
    submit();
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(attempts.getAttribute("aria-invalid")).toBe("true");
    input(attempts, "2");
    input(
      container.querySelector<HTMLInputElement>("#workflow-maxCostCents")!,
      "0.29",
    );
    submit();
    await vi.waitFor(() => expect(mocks.policy).toHaveBeenCalled());
    expect(mocks.policy.mock.calls[0][1].policy.limits).toEqual({
      maxAttempts: 2,
      maxCostCents: 29,
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Rules saved. Future eligible tasks will inherit them.",
      ),
    );
  });
  it("preserves edits when reloading a concurrent policy version", async () => {
    mocks.policy.mockRejectedValueOnce(new ApiError("conflict", 409, {}));
    await render();
    click("Edit rules");
    input(
      container.querySelector<HTMLInputElement>("#workflow-maxAttempts")!,
      "2",
    );
    submit();
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Rules changed elsewhere."),
    );
    config.policies[0].version = 4;
    click("Reload saved rules");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Policy version 4"),
    );
    await vi.waitFor(() =>
      expect(container.textContent).not.toContain("Rules changed elsewhere."),
    );
    expect(
      container.querySelector<HTMLInputElement>("#workflow-maxAttempts")!.value,
    ).toBe("2");
    submit();
    await vi.waitFor(() => expect(mocks.policy).toHaveBeenCalledTimes(2));
    expect(mocks.policy.mock.calls[1][1].expectedVersion).toBe(4);
  });
  it("opens and focuses the prepared draft, and protects it from silent replacement", async () => {
    await render();
    click("Improve this workflow");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Draft ready to edit."),
    );
    expect(document.activeElement?.tagName).toBe("H3");
    expect(container.textContent).toContain(
      "Observed problem and source evidence",
    );
    expect(container.textContent).toContain(
      "Validation plan and regression risks",
    );
    click("Improve this workflow");
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "A draft is already being edited.",
      ),
    );
    click("Keep editing");
    expect(container.textContent).not.toContain(
      "A draft is already being edited.",
    );
  });
  it("counts different objectives, blocks duplicate selection and starts only explicitly", async () => {
    config.revisions = [draftRevision()];
    mocks.baselines.mockResolvedValue({
      items: [0, 1, 2, 3].map((i) => ({
        id: `run-${i}`,
        issueId: `issue-${i}`,
        issueIdentifier: `AIG-${i}`,
        issueTitle: `Task ${i}`,
        objectiveTitle: `Objective ${i}`,
        objectiveFingerprint: i === 1 ? "objective-0" : `objective-${i}`,
        createdAt: "2026-11-03T00:00:00Z",
        finishedAt: null,
      })),
      hasMore: false,
    });
    await render();
    click("Open revision workspace");
    const picker = container.querySelector<HTMLSelectElement>(
      'select option[value="revision-1"]',
    )!.parentElement!;
    flushSync(() => {
      (picker as HTMLSelectElement).value = "revision-1";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(4),
    );
    const checks = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
    ];
    flushSync(() => checks[0].click());
    expect(checks[1].disabled).toBe(true);
    flushSync(() => {
      checks[2].click();
      checks[3].click();
    });
    expect(mocks.trials).not.toHaveBeenCalled();
    expect(button("Start 3 candidate tasks").disabled).toBe(false);
    click("Start 3 candidate tasks");
    await vi.waitFor(() =>
      expect(mocks.trials).toHaveBeenCalledWith("company-1", "revision-1", [
        "run-0",
        "run-2",
        "run-3",
      ]),
    );
  });
  it("restores unsaved edits on return without exposing them to another company or account", async () => {
    await render();
    click("Edit rules");
    input(
      container.querySelector<HTMLInputElement>("#workflow-maxAttempts")!,
      "2",
    );
    selection.companyId = "company-2";
    await render();
    expect(container.querySelector("#workflow-maxAttempts")).toBeNull();
    selection.companyId = "company-1";
    await render();
    expect(
      container.querySelector<HTMLInputElement>("#workflow-maxAttempts")!.value,
    ).toBe("2");
    selection.userId = "user-2";
    await render();
    expect(container.querySelector("#workflow-maxAttempts")).toBeNull();
  });
  it("adopts a newer version of the same template instead of retaining the old pin", async () => {
    config.policies[0].policy.revision = 1;
    config.revisions = [
      {
        ...draftRevision(),
        status: "published",
        definition: {
          ...BUILT_IN_WORKFLOW_TEMPLATES.find(
            (item) => item.key === "game-development",
          )!,
          name: "Studio v2",
        },
      },
    ];
    await render();
    const item = [...container.querySelectorAll("article")].find((row) =>
      row.textContent?.includes("Studio v2"),
    )!;
    flushSync(() =>
      [...item.querySelectorAll("button")]
        .find((row) => row.textContent === "Use this workflow")!
        .click(),
    );
    submit();
    await vi.waitFor(() => expect(mocks.policy).toHaveBeenCalled());
    expect(mocks.policy.mock.calls[0][1].policy).toMatchObject({
      templateKey: "game-development",
    });
    expect(mocks.policy.mock.calls[0][1].policy).not.toHaveProperty("revision");
  });
  it("loads the selected draft and blocks publication after editing its saved definition", async () => {
    config.revisions = [draftRevision()];
    mocks.evaluations.mockResolvedValue(
      [0, 1, 2].map((i) => ({
        id: `evaluation-${i}`,
        scenarioKey: `objective-${i}`,
        baselineRunId: `baseline-${i}`,
        candidateRunId: `candidate-${i}`,
        passed: true,
        findings: [],
      })),
    );
    await render();
    click("Open revision workspace");
    const picker = container.querySelector<HTMLOptionElement>(
      'select option[value="revision-1"]',
    )!.parentElement as HTMLSelectElement;
    flushSync(() => {
      picker.value = "revision-1";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click("3 · Review and publish");
    await vi.waitFor(() =>
      expect(button("Publish revision").disabled).toBe(false),
    );
    click("1 · Edit draft");
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")!.value,
    ).toBe(
      BUILT_IN_WORKFLOW_TEMPLATES.find(
        (item) => item.key === "game-development",
      )!.nodes[0].instructions,
    );
    input(
      container.querySelector<HTMLTextAreaElement>("textarea")!,
      "Retain extra reproducible evidence.",
    );
    click("3 · Review and publish");
    expect(button("Publish revision").disabled).toBe(true);
    expect(container.textContent).toContain(
      "Save the edited draft as a new revision",
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("provides recovery when account identity cannot be loaded", async () => {
    selection.failed = true;
    flushSync(() =>
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Workflows />
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    );
    expect(container.textContent).toContain("Could not verify your account.");
    expect(button("Retry")).toBeTruthy();
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
});
