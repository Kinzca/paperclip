// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { SharedAgentInstructionsEditor } from "./SharedAgentInstructionsEditor";

describe("shared instruction editor", () => {
  it("saves multiline edits, reports failures, and supports clearing", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const save = vi.fn<(value: string) => Promise<void>>().mockRejectedValueOnce(new Error("Permission denied")).mockResolvedValue(undefined);
    flushSync(() => root.render(<QueryClientProvider client={queryClient}><SharedAgentInstructionsEditor draftKey="save-test" saveLabel="Save global rules" title="Global agent instructions" description="Every run" value="Old rule" onSave={save} /></QueryClientProvider>));
    const textarea = container.querySelector("textarea")!;
    const saveButton = () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Save global rules")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    flushSync(() => { setValue.call(textarea, "# New rules\nCite sources."); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await vi.waitFor(() => expect(saveButton().disabled).toBe(false));
    flushSync(() => saveButton().click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("Permission denied"));
    expect(save).toHaveBeenLastCalledWith("# New rules\nCite sources.");
    flushSync(() => { setValue.call(textarea, ""); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await vi.waitFor(() => expect(saveButton().disabled).toBe(false));
    flushSync(() => saveButton().click());
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith(""));
    flushSync(() => root.unmount());
    queryClient.clear();
    container.remove();
  });
});
