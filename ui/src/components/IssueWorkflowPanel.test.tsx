// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowRunDetail,
} from "@paperclipai/shared";
import { IssueWorkflowPanel } from "./IssueWorkflowPanel";
import { setUiLocale } from "@/i18n/ui";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  control: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("../api/workflows", () => ({ workflowsApi: mocks }));
vi.mock("@/lib/router", async () => await import("react-router-dom"));
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
let run: WorkflowRunDetail;
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
function grantButton() {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "Add allowance and resume",
  )!;
}
async function render() {
  mocks.run.mockResolvedValue(run);
  flushSync(() =>
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <IssueWorkflowPanel issueId="task-1" />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  );
  await vi.waitFor(() =>
    expect(container.querySelector("section")).not.toBeNull(),
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  await setUiLocale("en");
  const definition = structuredClone(BUILT_IN_WORKFLOW_TEMPLATES[0]);
  run = {
    id: "run-1",
    companyId: "company-1",
    issueId: "task-1",
    isRoot: true,
    status: "waiting_human",
    version: 8,
    stopReason: "Workflow deadline reached",
    deadlineAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    snapshot: {
      schemaVersion: 1,
      templateKey: definition.key,
      revisionId: null,
      revision: 1,
      definition,
      limits: { ...DEFAULT_WORKFLOW_LIMITS, timeoutMinutes: 180 },
      executorAgentId: "agent-1",
      responsibleUserId: "user-1",
      objective: {
        title: "Keep the original task",
        description: null,
        plan: null,
      },
      policyVersions: [],
    },
    runtime: {},
    nodes: Object.fromEntries(
      definition.nodes.map((node) => [
        node.id,
        {
          status: "pending",
          attempt: 0,
          issueId: null,
          agentId: null,
          userId: null,
          startedAt: null,
          finishedAt: null,
          result: null,
        },
      ]),
    ),
    attempts: [],
  };
  mocks.control.mockResolvedValue({});
  container = document.createElement("div");
  document.body.append(container);
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
it("追加必须填写原因与正数增量，提交当前版本和增量", async () => {
  await render();
  expect(grantButton().disabled).toBe(true);
  input(
    container.querySelector("textarea")!,
    "External issue resolved; allow thirty minutes",
  );
  expect(grantButton().disabled).toBe(true);
  input(container.querySelectorAll("input")[1], "30");
  expect(grantButton().disabled).toBe(false);
  flushSync(() => grantButton().click());
  await vi.waitFor(() =>
    expect(mocks.control).toHaveBeenCalledWith("task-1", {
      action: "extend",
      expectedVersion: 8,
      reason: "External issue resolved; allow thirty minutes",
      extension: {
        additionalAttempts: 0,
        additionalMinutes: 30,
        additionalCostCents: 0,
      },
    }),
  );
});
it("人工等待显示停表状态，运行中不显示追加入口", async () => {
  run.status = "running";
  run.runtime = { humanWaitStartedAt: new Date().toISOString() };
  await render();
  expect(container.textContent).toContain(
    "Waiting for human acceptance — execution clock stopped.",
  );
  expect(grantButton()).toBeUndefined();
});
it.each(["cancelled", "succeeded", "running", "waiting_human"] as const)(
  "%s 工作流默认折叠，展开状态不被后台刷新重置",
  async (status) => {
    run.status = status;
    await render();
    const disclosure = container.querySelector("section > details")!;
    const summary = disclosure.querySelector("summary")!;
    expect(disclosure.hasAttribute("open")).toBe(false);
    expect(summary.textContent).toContain("Task workflow");
    expect(summary.textContent).toContain(status === "waiting_human" ? "waiting_human" : status);
    expect(container.querySelector("textarea") === null).toBe(
      status === "cancelled" || status === "succeeded",
    );
    disclosure.setAttribute("open", "");
    await client.invalidateQueries({ queryKey: ["issue-workflow", "task-1"] });
    expect(disclosure.hasAttribute("open")).toBe(true);
    expect(disclosure.textContent).toContain("Retained attempt evidence");
    expect(mocks.control).not.toHaveBeenCalled();
  },
);

it("requests unlimited resumption only with an operator reason and current version", async () => {
  await render();
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === "Resume without a time limit")!;
  expect(button.disabled).toBe(true);
  input(container.querySelector("textarea")!, "Continue the original task without a deadline");
  flushSync(() => button.click());
  await vi.waitFor(() => expect(mocks.control).toHaveBeenCalledWith("task-1", {
    action: "resume_unlimited", expectedVersion: 8, reason: "Continue the original task without a deadline",
  }));
});
it("displays an audited removed time limit without offering duplicate removal", async () => {
  run.runtime = { timeLimitRemoval: { userId: "operator", reason: "continue", grantedAt: new Date().toISOString() } };
  run.deadlineAt = null;
  await render();
  expect(container.textContent).toContain("No time limit");
  expect(container.textContent).not.toContain("Resume without a time limit");
});
