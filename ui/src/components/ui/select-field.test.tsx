// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SelectField } from "./select-field";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.unstubAllGlobals());

it("selects an actual empty option by keyboard and submits its raw form value", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const changes = vi.fn();
  function Form() {
    const [value, setValue] = useState("saved");
    return <form><SelectField name="account" aria-label="Account" value={value}
      onValueChange={next => { changes(next); setValue(next); }}>
      <option value="saved">Saved account</option><option value="">New account</option>
    </SelectField></form>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Form />));
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.textContent).toContain("Saved account");
    expect(changes).not.toHaveBeenCalled();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "New account")!;
    expect(option).toBeDefined();
    await act(async () => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(changes.mock.calls).toEqual([[""]]);
    expect(trigger.textContent).toContain("New account");
    expect(new FormData(container.querySelector("form")!).get("account")).toBe("");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
