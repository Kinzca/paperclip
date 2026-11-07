/** Find the raw form value belonging to a visible SelectField, not Radix's encoded input. */
export function selectFieldInput(root: ParentNode, selector = ""): HTMLSelectElement {
  const trigger = root.querySelector(`button[role="combobox"]${selector}`);
  if (!trigger) throw new Error(`SelectField trigger not found: ${selector}`);
  for (let element = trigger.nextElementSibling; element; element = element.nextElementSibling) {
    if (element instanceof HTMLSelectElement && element.matches('select.sr-only[aria-hidden="true"]')) return element;
    if (element.matches('button[role="combobox"]')) break;
  }
  throw new Error(`SelectField form input not found: ${selector}`);
}
