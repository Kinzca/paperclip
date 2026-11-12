import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, Building2, FolderOpen, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import type { StorageCleanupKind, StorageCleanupPreview, StorageCleanupResult } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { uiText, useUiLocale } from "@/i18n/ui";
import { Link } from "@/lib/router";
import { formatDateTime } from "@/lib/utils";

const categories = {
  database: ["Database", "bg-storage-database"], logs: ["Run logs", "bg-storage-logs"],
  files: ["Attachments and files", "bg-storage-files"], companyProjects: ["Company project directories", "bg-storage-projects"],
  workspaces: ["Managed workspaces", "bg-storage-workspaces"], backups: ["Database backups", "bg-storage-backups"],
  releases: ["Program releases", "bg-storage-releases"], checkpoints: ["Upgrade checkpoints", "bg-storage-checkpoints"],
  source: ["Source and development dependencies", "bg-storage-source"], tools: ["Tools and caches", "bg-storage-tools"],
  maintenance: ["Maintenance materials", "bg-storage-maintenance"], other: ["Other instance data", "bg-storage-other"],
} as const;
const cleanupKinds: StorageCleanupKind[] = ["backups", "releases", "checkpoints"];
// Decimal units match Finder and the workspace inventory. Shared legacy formatting remains unchanged.
function storageSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0; let value = bytes;
  while (Math.abs(value) >= 1000 && index < units.length - 1) { value /= 1000; index++; }
  return `${Number(value.toFixed(1))} ${units[index]}`;
}

export function StorageSettings() {
  const locale = useUiLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [expanded, setExpanded] = useState(true);
  const [kind, setKind] = useState<StorageCleanupKind>("backups");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState("");
  const [preview, setPreview] = useState<StorageCleanupPreview | null>(null);
  const [result, setResult] = useState<StorageCleanupResult | null>(null);
  useEffect(() => { setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" }, { label: uiText("Storage management") }]); }, [setBreadcrumbs, locale]);
  const usage = useQuery({ queryKey: ["instance-storage", expanded], queryFn: () => instanceSettingsApi.getStorageUsage(expanded), staleTime: 30_000, refetchOnWindowFocus: false, retry: false });
  const inventory = useQuery({ queryKey: ["storage-cleanup"], queryFn: instanceSettingsApi.getStorageCleanup, staleTime: 30_000, refetchOnWindowFocus: false, retry: false });
  const prepare = useMutation({ mutationFn: () => instanceSettingsApi.previewStorageCleanup([...selected]), onSuccess: value => { setPreview(value); setResult(null); } });
  const cleanup = useMutation({ mutationFn: () => instanceSettingsApi.executeStorageCleanup(preview!.token), onSuccess: value => {
    setResult(value); setSelected(new Set()); void inventory.refetch(); void usage.refetch();
  } });
  const busy = prepare.isPending || cleanup.isPending;
  const items = inventory.data?.items ?? [];
  const visible = items.filter(item => item.kind === kind);
  const selectedBytes = items.filter(item => selected.has(item.id)).reduce((sum, item) => sum + item.bytes, 0);
  function refresh() { setSelected(new Set()); setPreview(null); void usage.refetch(); void inventory.refetch(); }
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2"><h1 className="flex items-center gap-2 text-lg font-semibold"><HardDrive className="size-5" />{uiText("Storage management")}</h1>
        <p className="text-sm text-muted-foreground">{uiText("Paperclip installation, instance data and registered projects, across all organizations.")}</p></div>
      <Button variant="secondary" disabled={busy || usage.isFetching || inventory.isFetching} onClick={refresh}><RefreshCw className="size-4" />{uiText("Refresh")}</Button>
    </header>
    <section className="flex flex-col gap-4" aria-busy={usage.isFetching}>
      {usage.isPending && <p role="status">{uiText("Measuring the full installation. Large directories may take a moment...")}</p>}
      {usage.isError && <p role="alert" className="text-destructive">{String(usage.error.message)}</p>}
      {usage.data && <>
        <div className="flex flex-wrap items-baseline gap-3"><p className="text-3xl font-semibold font-mono">{storageSize(usage.data.totalBytes)}</p>
          <span className="text-sm text-muted-foreground">{uiText(usage.data.complete ? "Total file size" : "At least — inventory incomplete")}</span></div>
        <div className="flex h-5 overflow-hidden rounded-lg bg-muted" role="img" aria-label={uiText("Storage usage by category")}>
          {usage.data.categories.filter(item => item.bytes > 0).map(item => <div key={item.key} className={`basis-0 ${categories[item.key][1]}`} style={{ flexGrow: item.bytes }} title={`${uiText(categories[item.key][0])}: ${storageSize(item.bytes)}`} />)}
        </div>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{usage.data.categories.map(item => <div key={item.key} className="flex flex-col gap-1">
          <dt className="flex items-center gap-2 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${categories[item.key][1]}`} />{uiText(categories[item.key][0])}</dt>
          <dd className="font-mono text-sm">{storageSize(item.bytes)}</dd>
        </div>)}</dl>
        {!usage.data.complete && <p role="status" className="text-sm text-muted-foreground">{uiText("Some paths were unreadable or the scan reached its limit. Refresh to retry; values are a lower bound.")}</p>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{uiText("Inventory scope and measurement")}</summary>
          <div className="flex flex-col gap-2 py-3"><p>{uiText("Logical file sizes, 1 GB = 1,000,000,000 bytes. Overlapping paths count once. Symlink targets and remote storage are excluded; file size is not reclaimable disk space.")}</p>
            <p>{uiText("Measured {{value0}}. Results are cached for 30 seconds.", { value0: formatDateTime(usage.data.measuredAt) })}</p>
            {!usage.data.roots?.some(root => root.category === "releases") && <p>{uiText("Installation resources are not registered by this startup method. Restart through the updated local launcher to include them.")}</p>}
            {usage.data.roots?.map(root => <p key={`${root.category}:${root.path}`} className="break-all font-mono">{root.path}</p>)}
            <Button variant="ghost" className="self-start" onClick={() => setExpanded(!expanded)}>{uiText(expanded ? "Use quick inventory" : "Expand inventory (read-only)")}</Button>
          </div></details>
      </>}
    </section>

    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-col gap-1"><h2 className="flex items-center gap-2 font-semibold"><Trash2 className="size-4" />{uiText("Clean up space")}</h2>
        <p className="text-sm text-muted-foreground">{uiText("Select old backups, releases or checkpoints. Review the exact deletion list before cleaning.")}</p></div>
        <Button disabled={!selected.size || busy} onClick={() => prepare.mutate()}>{uiText(prepare.isPending ? "Preparing preview..." : "Preview cleanup ({{value0}})", { value0: selected.size })}</Button>
      </div>
      <div className="flex flex-wrap gap-2">{cleanupKinds.map(value => <Button key={value} variant={kind === value ? "secondary" : "ghost"} onClick={() => setKind(value)} disabled={busy}>
        {uiText(categories[value][0])} · {items.filter(item => item.kind === value).length}
      </Button>)}</div>
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

    <div className="flex flex-wrap gap-3">
      <Button variant="outline" asChild><Link to="/company/settings/instance/project-space"><Building2 className="size-4" />{uiText("Company and project space")}</Link></Button>
      <Button variant="outline" asChild><Link to="/company/settings/instance/archived-chats"><Archive className="size-4" />{uiText("Archived chats")}</Link></Button>
      <Button variant="outline" asChild><Link to="/workspaces"><FolderOpen className="size-4" />{uiText("Managed workspaces")}</Link></Button>
    </div>
    <AlertDialog open={!!preview} onOpenChange={open => { if (!open && !cleanup.isPending) { setPreview(null); cleanup.reset(); } }}>
      <AlertDialogContent className="flex max-h-(--sz-85vh) flex-col overflow-hidden sm:max-w-3xl">
        <AlertDialogHeader><AlertDialogTitle>{uiText(result ? "Cleanup results" : "Confirm permanent cleanup")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("Only the paths listed below will be deleted. This cannot be undone. Protected resources and business data are retained.")}</AlertDialogDescription></AlertDialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          <p className="text-sm">{uiText("Estimated file size: {{value0}}. Actual disk recovery can differ because of shared blocks and snapshots.", { value0: storageSize(preview?.estimatedBytes ?? 0) })}</p>
          {preview?.items.map(item => <div key={item.id} className="flex flex-col gap-1 border-b py-2"><p className="break-all font-mono text-xs">{item.path}</p><p className="text-sm">{uiText(categories[item.kind][0])} · {storageSize(item.bytes)}</p></div>)}
          {cleanup.isError && <p role="alert" className="text-sm text-destructive">{cleanup.error.message}</p>}
          {result?.auditWarning && <p role="alert" className="text-sm text-destructive">{result.auditWarning}</p>}
          {result && <><p role="status" className="text-sm">{uiText("Deleted file size: {{value0}} · filesystem available-space change: {{value1}}", { value0: storageSize(result.deletedLogicalBytes), value1: result.availableBytesChange === null ? uiText("Unknown") : storageSize(result.availableBytesChange) })}</p>
            <p className="text-xs text-muted-foreground">{uiText("Available-space changes may also include other activity on this filesystem.")}</p>
            {result.results.map(item => <p key={item.id} className={`break-all text-xs ${item.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{uiText(item.status === "deleted" ? "Deleted" : "Retained / failed")} · {item.path}{item.reason ? ` · ${item.reason}` : ""}</p>)}</>}
        </div>
        <AlertDialogFooter className="shrink-0 sm:justify-between"><AlertDialogCancel disabled={cleanup.isPending}>{uiText(result ? "Close" : "Cancel")}</AlertDialogCancel>
          {!result && <Button variant="destructive" disabled={cleanup.isPending || cleanup.isError || prepare.isPending} onClick={() => cleanup.mutate()}>{uiText(cleanup.isPending ? "Cleaning..." : "Permanently delete selected items")}</Button>}</AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
