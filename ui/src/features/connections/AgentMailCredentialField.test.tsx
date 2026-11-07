// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AgentMailCredentialField } from "./AgentMailCredentialField";
import { selectFieldInput } from "@/test/select-field";

const credentials = vi.hoisted(() => vi.fn());
vi.mock("@/api/email", () => ({ emailApi: { credentials } }));

it("keeps the discovered account selected without emitting a new-key choice", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  credentials.mockResolvedValue([{ id: "saved-account", label: "Saved account", scope: "organization", createdAt: "2026-01-01T00:00:00Z" }]);
  const changes = vi.fn();
  function Form() {
    const [connectionId, setConnectionId] = useState<string | null>(null);
    return <form><AgentMailCredentialField companyId="fixture" connectionId={connectionId} value="" onChange={() => {}}
      onConnectionChange={id => { changes(id); setConnectionId(id); }} /></form>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Form /></QueryClientProvider>));
    await vi.waitFor(() => expect(changes.mock.calls.map(call => call[0])).toEqual(["saved-account"]));
    expect(selectFieldInput(container).value).toBe("saved-account");
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain("Saved account");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
