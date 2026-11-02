// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Company } from "@paperclipai/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanySettings } from "./CompanySettings";
import { TooltipProvider } from "@/components/ui/tooltip";

const state = vi.hoisted(() => ({ company: { id: "studio-a", name: "Studio A", description: "Original description", agentInstructions: "Saved additions", issuePrefix: "AIG" } }));
const update = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({ source: "local_implicit", isInstanceAdmin: true, companyIds: ["studio-a"], memberships: [] as Array<{ companyId: string; membershipRole: string; status: string }> }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ companies: [state.company], selectedCompany: state.company, selectedCompanyId: state.company.id, setSelectedCompanyId: vi.fn() }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: "alice", settled: true, failed: false }) }));
vi.mock("../api/companies", () => ({ companiesApi: { update } }));
vi.mock("../api/access", () => ({ accessApi: { getCurrentBoardAccess: async () => access } }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: { getGeneral: async () => ({ agentInstructions: "GLOBAL_SAVED" }), updateGeneral: vi.fn() } }));
vi.mock("../api/health", () => ({ healthApi: { get: async () => ({ hiddenSettings: [] }) } }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../context/ToastContext", () => ({ useOptionalToastActions: () => null }));
vi.mock("../hooks/useCloudInstance", () => ({ useCloudInstance: () => null }));
vi.mock("../hooks/useFastResponsesEnabled", () => ({ useFastResponsesEnabled: () => ({ loaded: true, enabled: true }) }));
vi.mock("../components/InteractionGovernancePanel", () => ({ InteractionGovernancePanel: () => null, applyGovernanceChange: vi.fn() }));
vi.mock("../components/CompanyPatternIcon", () => ({ CompanyPatternIcon: () => null }));
vi.mock("./InstanceGeneralSettings", () => ({ InstanceGeneralSettings: () => null }));

afterEach(() => { sessionStorage.clear(); vi.clearAllMocks(); access.source = "local_implicit"; access.isInstanceAdmin = true; access.memberships = []; });

describe("organization settings drafts", () => {
  it("keeps a late save response attached to its original organization after switching", async () => {
    const original = { ...state.company };
    let finishSave!: (company: typeof state.company) => void;
    update.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const render = () => flushSync(() => root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider><CompanySettings /></TooltipProvider></MemoryRouter></QueryClientProvider>));
    render();
    const input = container.querySelector("input")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed A");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await vi.waitFor(() => expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent === "Save changes")).toBe(true));
    flushSync(() => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Save changes")!.click());
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith("studio-a", expect.objectContaining({ name: "Renamed A" })));
    state.company = { ...original, id: "studio-b", name: "Studio B", description: "Description B" };
    render();
    finishSave({ ...original, name: "Renamed A" });
    await vi.waitFor(() => expect(container.querySelectorAll("input")[0]!.value).toBe("Studio B"));
    expect(container.querySelectorAll("input")[1]!.value).toBe("Description B");
    state.company = { ...original, name: "Renamed A" };
    render();
    expect(container.querySelectorAll("input")[0]!.value).toBe("Renamed A");
    flushSync(() => root.unmount()); client.clear(); container.remove(); state.company = original;
  });

  it("preserves name and description while saving rules, and previews saved rules instead of drafts", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const render = () => flushSync(() => root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider><CompanySettings /></TooltipProvider></MemoryRouter></QueryClientProvider>));
    update.mockImplementation(async (_id, patch) => ({ ...state.company, ...patch } as Company));
    render();
    await vi.waitFor(() => expect(container.querySelectorAll("textarea")).toHaveLength(2));
    const fields = container.querySelectorAll("input");
    const type = (field: HTMLInputElement | HTMLTextAreaElement, text: string) => flushSync(() => {
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    type(fields[0]!, "My organization name draft");
    type(fields[1]!, "My description draft");
    type(container.querySelectorAll("textarea")[1]!, "New additions");
    const save = () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Save organization additions")!;
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    expect(container.querySelectorAll("pre")[1]!.textContent).toBe("Saved additions");
    flushSync(() => save().click());
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith("studio-a", { agentInstructions: "New additions" }));
    state.company = { ...state.company, agentInstructions: "New additions" };
    render();
    await vi.waitFor(() => expect(container.querySelectorAll("pre")[1]!.textContent).toBe("New additions"));
    expect(container.querySelectorAll("input")[0]!.value).toBe("My organization name draft");
    expect(container.querySelectorAll("input")[1]!.value).toBe("My description draft");
    expect(container.querySelectorAll("pre")[0]!.textContent).toBe("GLOBAL_SAVED");
    flushSync(() => root.unmount()); client.clear(); container.remove();
  });

  it("shows global rules as read-only to a company member while keeping organization additions editable", async () => {
    access.source = "session"; access.isInstanceAdmin = false;
    access.memberships = [{ companyId: "studio-a", membershipRole: "member", status: "active" }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    flushSync(() => root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider><CompanySettings /></TooltipProvider></MemoryRouter></QueryClientProvider>));
    await vi.waitFor(() => expect(container.querySelectorAll("textarea")).toHaveLength(2));
    expect(container.querySelectorAll("textarea")[0]!.readOnly).toBe(true);
    expect(container.querySelectorAll("textarea")[1]!.readOnly).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent === "Save global rules")).toBe(false);
    expect(container.textContent).toContain("Only instance administrators can edit this layer.");
    flushSync(() => root.unmount()); client.clear(); container.remove();
  });
});
