import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { uiText, useUiLocale } from "@/i18n/ui";
import { Button } from "./ui/button";
import { useSettingsDraft } from "@/hooks/useSettingsDraft";

export function SharedAgentInstructionsEditor({ title, description, value, onSave, draftKey, saveLabel, readOnly = false }: {
  title: string;
  description: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  draftKey: string;
  saveLabel: string;
  readOnly?: boolean;
}) {
  useUiLocale();
  const id = useId();
  const draft = useSettingsDraft(draftKey, value);
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (instructions: string) => onSave(instructions),
    onSuccess: (_result, submitted) => { draft.saved(submitted); setSavedValue(submitted); },
  });
  return (
    <section className="max-w-2xl space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p>
      <textarea
        aria-label={title}
        rows={8}
        maxLength={32000}
        aria-describedby={`${id}-description ${id}-status${mutation.error ? ` ${id}-error` : ""}`}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={readOnly ? value : draft.text}
        readOnly={readOnly}
        onChange={event => { draft.change(event.target.value); setSavedValue(null); mutation.reset(); }}
        disabled={mutation.isPending}
      />
      {draft.conflict && !readOnly ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm">{uiText("Saved rules changed elsewhere. Your draft is preserved. Compare before saving.")}</p>
          <details className="text-sm">
            <summary className="cursor-pointer">{uiText("View latest saved rules")}</summary>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{value || uiText("No saved rules.")}</pre>
          </details>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => { draft.keepDraft(); setSavedValue(null); }}>{uiText("Keep my draft")}</Button>
        </div>
      ) : null}
      <p id={`${id}-status`} className="text-sm text-muted-foreground" role="status">
          {readOnly ? uiText("Read only. Contact an administrator to change these rules.")
            : draft.dirty ? uiText("Unsaved draft — retained in this tab when switching organizations.")
              : savedValue === value ? uiText("Shared instructions saved. They apply to the next agent run.")
                : uiText("Leave empty to remove these shared instructions.")}
      </p>
      {!readOnly ? <div className="flex flex-wrap items-center justify-between gap-3">
          {draft.dirty ? <Button variant="ghost" disabled={mutation.isPending} onClick={() => { draft.discard(); setSavedValue(null); mutation.reset(); }}>{uiText("Discard changes")}</Button> : <span />}
          <Button disabled={mutation.isPending || !draft.dirty || draft.conflict} onClick={() => mutation.mutate(draft.text)}>
            {mutation.isPending ? uiText("Saving...") : saveLabel}
          </Button>
      </div> : null}
      {mutation.error ? <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{mutation.error.message}</p> : null}
    </section>
  );
}
