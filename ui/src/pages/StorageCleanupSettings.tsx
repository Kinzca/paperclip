import { getUiLocale } from "@/i18n/ui";
import { CleanupFeedbackDialog, type CleanupFeedbackState } from "@/components/CleanupFeedbackDialog";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import type { StorageCleanupKind, StorageCleanupPreview, StorageCleanupResult } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "@/lib/router";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { uiText, useUiLocale } from "@/i18n/ui";
import { formatDateTime } from "@/lib/utils";
import { storageCategories as categories, storageSize } from "@/lib/storage";

export function StorageCleanupSettings({ kind }: { kind: StorageCleanupKind }) {
  useUiLocale();
  return <StorageCleanupContent key={kind} kind={kind} />;
}

function StorageCleanupContent({ kind }: { kind: StorageCleanupKind }) {
  const locale = useUiLocale();
  const { hidden } = useHiddenSettings();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState("");
  const [preview, setPreview] = useState<StorageCleanupPreview | null>(null);
  const [result, setResult] = useState<StorageCleanupResult | null>(null);
  useEffect(() => { setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" },
    { label: uiText("Storage"), href: "/company/settings/instance/storage" },
    { label: uiText(categories[kind][0]) }]); }, [setBreadcrumbs, locale, kind, getUiLocale()]);
  const inventory = useQuery({ queryKey: ["storage-cleanup"], queryFn: instanceSettingsApi.getStorageCleanup,
    staleTime: 30_000, refetchOnWindowFocus: false, retry: false });
  const prepare = useMutation({ mutationFn: () => instanceSettingsApi.previewStorageCleanup([...selected]),
    onSuccess: value => { setPreview(value); setResult(null); } });
  const cleanup = useMutation({ mutationFn: () => instanceSettingsApi.executeStorageCleanup(preview!.token), onSuccess: value => {
    setResult(value); setSelected(new Set()); void inventory.refetch();
    void queryClient.invalidateQueries({ queryKey: ["instance-storage"] });
  } });
  const failures = result?.results.filter(item => item.status === "failed") ?? [];
  const feedback: CleanupFeedbackState | null = cleanup.isPending ? { phase: "cleaning" }
    : result ? {
      phase: failures.length || result.auditWarning ? "partial" : "complete",
      completed: result.results.filter(item => item.status === "deleted").length,
      attention: failures.length,
      metric: { label: uiText("Files cleaned up"), value: storageSize(result.deletedLogicalBytes) },
      secondaryMetric: result.availableBytesChange === null ? undefined : {
        label: uiText("Filesystem available-space change"), value: storageSize(result.availableBytesChange) },
      warning: result.auditWarning ?? uiText("Available-space changes may also include other activity on this filesystem."),
      details: result.results.map(item => ({ label: item.path,
        note: item.status === "deleted" ? uiText("Deleted") : item.reason ?? uiText("Retained / failed") })),
    } : cleanup.isError ? { phase: "error", warning: cleanup.error.message } : null;
  const busy = prepare.isPending || cleanup.isPending;
  const visible = (inventory.data?.items ?? []).filter(item => item.kind === kind);
  const selectedBytes = visible.filter(item => selected.has(item.id)).reduce((sum, item) => sum + item.bytes, 0);
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
    <header className="flex items-center justify-between gap-4">
      <h1 className="text-xl font-semibold">{uiText(categories[kind][0])}</h1>
      <Button size="sm" variant="secondary" disabled={busy || inventory.isFetching} onClick={() => {
        setSelected(new Set()); setPreview(null); void inventory.refetch();
      }}><RefreshCw className={inventory.isFetching ? "size-4 animate-spin" : "size-4"} />{uiText("Refresh")}</Button>
    </header>
    {kind === "backups" && !hidden.has("instance.general.backupRetention") && <Button variant="outline" className="self-start" asChild>
      <Link to="/company/settings/instance/storage/database-backups/retention">{uiText("Backup retention")}</Link>
    </Button>}
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-col gap-1"><h2 className="flex items-center gap-2 font-semibold"><Trash2 className="size-4" />{uiText("Clean up space")}</h2>
        <p className="text-sm text-muted-foreground">{uiText("Select items to remove, then review the exact deletion list before cleaning.")}</p></div>
        <Button disabled={!selected.size || busy} onClick={() => prepare.mutate()}>{uiText(prepare.isPending ? "Preparing preview..." : "Preview cleanup ({{value0}})", { value0: selected.size })}</Button>
      </div>
      {inventory.isPending && <p role="status" className="text-sm">{uiText("Loading cleanup items...")}</p>}
      {inventory.isError && <p role="alert" className="text-sm text-destructive">{inventory.error.message}</p>}
      {inventory.data?.unavailable.map(message => <p role="status" key={message} className="text-sm text-muted-foreground">{message}</p>)}
      <p className="text-sm text-muted-foreground">{uiText(kind === "backups" ? "Deleting backups removes historical restore points. The latest backup is retained. This does not change automatic backup settings."
        : kind === "releases" ? "Deleting a release removes its local program files. Running, selected and previous releases are protected; old code may need rebuilding."
        : "Deleting a checkpoint removes its database, configuration and plugin recovery files. Recovery to that pre-upgrade state may become unavailable.")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy || !visible.some(item => !item.protectedReason && item.complete)} onClick={() => setSelected(new Set([...selected, ...visible.filter(item => !item.protectedReason && item.complete).map(item => item.id)].slice(0, 200)))}>{uiText("Select available items")}</Button>
        <Button size="sm" variant="ghost" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>{uiText("Clear selection")}</Button>
        <label className="flex items-center gap-2 text-sm">{uiText("Keep newest")}
          <Input className="w-20" type="number" min="1" step="1" value={keep} disabled={busy} onChange={event => setKeep(event.target.value)} aria-label={uiText("Number to retain")} /></label>
        <Button size="sm" variant="outline" disabled={busy || !Number.isInteger(Number(keep)) || Number(keep) < 1} onClick={() => {
          const remaining = new Set([...selected].filter(id => !visible.some(item => item.id === id)));
          visible.slice(Number(keep)).filter(item => !item.protectedReason && item.complete).forEach(item => remaining.add(item.id)); setSelected(new Set([...remaining].slice(0, 200)));
        }}>{uiText("Select older items")}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{uiText("Up to 200 items per cleanup. Retention selection does not change future backup settings.")}</p>
      <p className="text-sm font-medium">{uiText("Selected {{value0}} items · estimated file size {{value1}}", { value0: selected.size, value1: storageSize(selectedBytes) })}</p>
      {prepare.isError && <p role="alert" className="text-sm text-destructive">{prepare.error.message}</p>}
      <div className="max-h-(--sz-60vh) overflow-auto divide-y">
        {visible.map(item => <label key={item.id} className="flex items-start gap-3 py-3">
          <Checkbox checked={selected.has(item.id)} disabled={busy || !!item.protectedReason || !item.complete || (selected.size >= 200 && !selected.has(item.id))} aria-label={item.name} onCheckedChange={checked => setSelected(prior => { const next = new Set(prior); if (checked) next.add(item.id); else next.delete(item.id); return next; })} />
          <div className="flex min-w-0 flex-1 flex-col gap-1"><span className="break-all font-mono text-sm">{item.name}</span>
            <span className="break-all text-xs text-muted-foreground">{item.path}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(item.modifiedAt)} · {item.protectedReason ?? uiText("Available for selection; references are checked again when cleaning")}</span></div>
          <span className="shrink-0 font-mono text-sm">{item.complete ? storageSize(item.bytes) : uiText("Incomplete")}</span>
        </label>)}
        {!inventory.isFetching && !visible.length && <p className="py-4 text-sm text-muted-foreground">{uiText("No items in this category.")}</p>}
      </div>
    </section>

    <AlertDialog open={!!preview && !feedback} onOpenChange={open => { if (!open && !cleanup.isPending) { setPreview(null); cleanup.reset(); } }}>
      <AlertDialogContent className="flex max-h-(--sz-85vh) flex-col overflow-hidden sm:max-w-3xl">
        <AlertDialogHeader><AlertDialogTitle>{uiText("Confirm permanent cleanup")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("Only the paths listed below will be deleted. This cannot be undone. Protected resources and business data are retained.")}</AlertDialogDescription></AlertDialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          <p className="text-sm">{uiText("Estimated file size: {{value0}}. Actual disk recovery can differ because of shared blocks and snapshots.", { value0: storageSize(preview?.estimatedBytes ?? 0) })}</p>
          {preview?.items.map(item => <div key={item.id} className="flex flex-col gap-1 border-b py-2"><p className="break-all font-mono text-xs">{item.path}</p><p className="text-sm">{uiText(categories[item.kind][0])} · {storageSize(item.bytes)}</p></div>)}

        </div>
        <AlertDialogFooter className="shrink-0 sm:justify-between"><AlertDialogCancel disabled={cleanup.isPending}>{uiText("Cancel")}</AlertDialogCancel>
          {!result && <Button variant="destructive" disabled={cleanup.isPending || cleanup.isError || prepare.isPending} onClick={() => cleanup.mutate()}>{uiText(cleanup.isPending ? "Cleaning..." : "Permanently delete selected items")}</Button>}</AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <CleanupFeedbackDialog state={feedback} onClose={() => { setPreview(null); setResult(null); cleanup.reset(); }} />
  </div>;
}
