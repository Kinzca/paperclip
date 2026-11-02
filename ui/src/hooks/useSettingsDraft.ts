import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
interface SettingsDraft { base: string; text: string }

function readStoredDraft(key: string, value: string): SettingsDraft {
  // Browser storage is an untrusted, optional boundary. The query cache keeps
  // drafts across SPA navigation even when storage is disabled or full.
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (parsed && typeof parsed === "object" && "base" in parsed && "text" in parsed
      && typeof parsed.base === "string" && typeof parsed.text === "string") return { base: parsed.base, text: parsed.text };
  } catch { /* Use the current server value when storage cannot be read. */ }
  return { base: value, text: value };
}

/** The caller supplies an account- and resource-scoped key. Drafts never sync across tabs. */
export function useSettingsDraft(scope: string, value: string) {
  const client = useQueryClient();
  const key = ["settings-draft", scope] as const;
  const storageKey = `paperclip.settings-draft:${scope}`;
  const { data: draft } = useQuery({
    queryKey: key,
    queryFn: () => readStoredDraft(storageKey, value),
    initialData: () => readStoredDraft(storageKey, value),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    client.setQueryData<SettingsDraft>(["settings-draft", scope], current => {
      if (!current || current.text === value || current.text === current.base) {
        return current?.base === value && current.text === value ? current : { base: value, text: value };
      }
      return current;
    });
  }, [client, scope, value]);

  useEffect(() => {
    try {
      if (draft.text === draft.base) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch { /* The in-memory draft remains available. */ }
  }, [storageKey, draft]);

  useEffect(() => {
    const protectDrafts = (event: BeforeUnloadEvent) => {
      if (client.getQueriesData<SettingsDraft>({ queryKey: ["settings-draft"] })
        .some(([, current]) => current && current.text !== current.base)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protectDrafts);
    return () => window.removeEventListener("beforeunload", protectDrafts);
  }, [client]);

  return {
    text: draft.text,
    dirty: draft.text !== draft.base,
    conflict: draft.text !== draft.base && draft.base !== value && draft.text !== value,
    change(text: string) { client.setQueryData<SettingsDraft>(key, { ...draft, text }); },
    discard() { client.setQueryData<SettingsDraft>(key, { base: value, text: value }); },
    keepDraft() { client.setQueryData<SettingsDraft>(key, { base: value, text: draft.text }); },
    saved(submitted: string, savedValue = submitted) {
      client.setQueryData<SettingsDraft>(key, current => ({
        base: savedValue,
        text: !current || current.text === submitted ? savedValue : current.text,
      }));
    },
  };
}
