// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const shell = vi.hoisted(() => ({ enabled: true, loaded: true }));
vi.mock("./hooks/useStreamlinedUiEnabled", () => ({
  useStreamlinedUiEnabled: () => shell,
}));

// Sandpack's Stitches marker is invalid CSS in jsdom. Keep the real App import
// graph without exercising this unrelated editor marker.
vi.hoisted(() => {
  const original = window.CSSStyleSheet.prototype.insertRule;
  window.CSSStyleSheet.prototype.insertRule = function (rule, index) {
    return original.call(this, rule.startsWith("--sxs") ? ".workflow-routing-noop{}" : rule, index);
  };
});

vi.mock("./components/Layout", async () => {
  const { Outlet } = await import("react-router-dom");
  const { NavLink } = await import("./lib/router");
  return { Layout: () => <><NavLink to="/workflows">Workflows</NavLink><Outlet /></> };
});
vi.mock("./components/Layout.production", async () => {
  const { Outlet } = await import("react-router-dom");
  return { Layout: () => <Outlet /> };
});
vi.mock("./components/CloudAccessGate", async () => {
  const { Outlet } = await import("react-router-dom");
  return { CloudAccessGate: () => <Outlet /> };
});
vi.mock("./components/OnboardingWizardVariant", () => ({
  OnboardingWizardVariant: () => null,
}));
vi.mock("./pages/Workflows", () => ({
  Workflows: () => {
    const { pathname, search, hash } = useLocation();
    return <div>{`WORKFLOWS_PAGE@${pathname}${search}${hash}`}</div>;
  },
}));
vi.mock("./pages/Dashboard", () => ({ Dashboard: () => <div>DASHBOARD_PAGE</div> }));

const companies = [
  { id: "company-1", name: "AIGameStudio", issuePrefix: "AIG", status: "active" },
  { id: "company-2", name: "Content", issuePrefix: "CMP", status: "active" },
];
let selectedCompany = companies[0]!;
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies,
    selectedCompany,
    selectedCompanyId: selectedCompany.id,
    loading: false,
  }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe.each([true, false])("App workflow routing (streamlined=%s)", (streamlined) => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    shell.enabled = streamlined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it.each(companies)("redirects /workflows to the selected $issuePrefix company", async (company) => {
    selectedCompany = company;
    flushSync(() => root.render(
      <MemoryRouter initialEntries={["/workflows?tab=templates#defaults"]}>
        <App />
      </MemoryRouter>,
    ));
    await vi.waitFor(() => expect(container.textContent).toContain(
      `WORKFLOWS_PAGE@/${company.issuePrefix}/workflows?tab=templates#defaults`,
    ));
  });

  it("keeps an explicit company in the URL when another company is selected", async () => {
    selectedCompany = companies[1]!;
    flushSync(() => root.render(
      <MemoryRouter initialEntries={["/AIG/workflows"]}>
        <App />
      </MemoryRouter>,
    ));
    await vi.waitFor(() => expect(container.textContent).toContain("WORKFLOWS_PAGE@/AIG/workflows"));
    if (streamlined) {
      expect(container.querySelector("a")?.getAttribute("href")).toBe("/AIG/workflows");
    }
  });
});
