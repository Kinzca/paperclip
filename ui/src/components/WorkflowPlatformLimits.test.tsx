// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowPlatformLimits } from "./WorkflowPlatformLimits";
import { setUiLocale } from "@/i18n/ui";

const mocks = vi.hoisted(() => ({ platform: vi.fn(), savePlatform: vi.fn() }));
vi.mock("@/api/workflows", () => ({ workflowsApi: mocks }));
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
const platform = {
  version: 7,
  policy: {
    enabled: false,
    templateKey: "standard",
    instructions: "Keep the organizational rules",
    limits: { maxAttempts: 3, timeoutMinutes: 60, maxParallelism: 2 },
  },
  allowHostCommands: false,
};
function button(text: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
function input(index: number, value: string) {
  const field = document.querySelectorAll("input")[index];
  flushSync(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function open() {
  flushSync(() =>
    root.render(
      <QueryClientProvider client={client}>
        <WorkflowPlatformLimits />
      </QueryClientProvider>,
    ),
  );
  flushSync(() => button("Platform limits").click());
  await vi.waitFor(() =>
    expect(document.querySelectorAll("input")).toHaveLength(4),
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  await setUiLocale("en");
  mocks.platform.mockResolvedValue(structuredClone(platform));
  mocks.savePlatform.mockResolvedValue({});
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

it("平台保存保留其它策略和命令开关，带原版本更新额度", async () => {
  await open();
  input(0, "5");
  input(1, "180");
  flushSync(() => button("Save platform limits").click());
  await vi.waitFor(() =>
    expect(mocks.savePlatform).toHaveBeenCalledWith({
      expectedVersion: 7,
      policy: {
        ...platform.policy,
        limits: {
          maxAttempts: 5,
          timeoutMinutes: 180,
          maxParallelism: 2,
          maxCostCents: null,
        },
      },
      allowHostCommands: false,
    }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).toBeNull(),
  );
});
it("保存冲突保留输入并显示错误，不覆盖更新后的配置", async () => {
  mocks.savePlatform.mockRejectedValue(
    new Error("Platform changed; reload before saving"),
  );
  await open();
  input(0, "5");
  flushSync(() => button("Save platform limits").click());
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Platform changed",
    ),
  );
  expect(document.querySelector("input")?.value).toBe("5");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
it("超出技术边界时禁用保存，避免无效请求", async () => {
  await open();
  input(0, "11");
  expect(button("Save platform limits").disabled).toBe(true);
  expect(mocks.savePlatform).not.toHaveBeenCalled();
});

it("saves blank execution minutes as an explicit unlimited ceiling", async () => {
  await open();
  input(1, "");
  flushSync(() => button("Save platform limits").click());
  await vi.waitFor(() => expect(mocks.savePlatform).toHaveBeenCalledWith(expect.objectContaining({ policy: expect.objectContaining({ limits: expect.objectContaining({ timeoutMinutes: null }) }) })));
});
