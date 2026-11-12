import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Building2, Database, FolderOpen, History, Layers, RefreshCw } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { uiText, useUiLocale } from "@/i18n/ui";
import { Link } from "@/lib/router";
import { formatDateTime } from "@/lib/utils";
import { storageCategories, storageSize } from "@/lib/storage";

const managementLinks = [
  { title: "Database backups", description: "Review restore points and clean up old database backups.", path: "/company/settings/instance/storage/database-backups", icon: Database },
  { title: "Program releases", description: "Review installed versions and remove unused historical releases.", path: "/company/settings/instance/storage/program-releases", icon: Layers },
  { title: "Upgrade checkpoints", description: "Review pre-upgrade recovery files and choose which checkpoints to retain.", path: "/company/settings/instance/storage/upgrade-checkpoints", icon: History },
  { title: "Company and project space", description: "Inspect local directories by company and project, with cleanup protection levels.", path: "/company/settings/instance/storage/project-space", icon: Building2 },
  { title: "Archived chats", description: "Review, restore or permanently delete individual archived conversations.", path: "/company/settings/instance/storage/archived-chats", icon: Archive },
  { title: "Managed workspaces", description: "Inspect workspaces and their tasks before deciding what to retain.", path: "/company/settings/instance/storage/workspaces", icon: FolderOpen },
];

export function StorageSettings() {
  const locale = useUiLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" }, { label: uiText("Storage") }]); }, [setBreadcrumbs, locale]);
  const usage = useQuery({ queryKey: ["instance-storage", true], queryFn: () => instanceSettingsApi.getStorageUsage(true),
    staleTime: 30_000, refetchOnWindowFocus: false, retry: false });
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
    <h1 className="text-lg font-semibold">{uiText("Storage")}</h1>
    <section className="flex flex-col gap-4" aria-busy={usage.isFetching}>
      <div className="flex flex-col gap-1"><h2 className="font-medium">{uiText("This device")}</h2>
        <p className="text-sm text-muted-foreground">{uiText("Paperclip installation, instance data and registered projects, across all organizations.")}</p></div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{usage.data ? uiText(usage.data.complete ? "Paperclip uses {{value0}}" : "Paperclip uses at least {{value0}}", { value0: storageSize(usage.data.totalBytes) })
          : uiText("Measuring the full installation. Large directories may take a moment...")}</p>
        <Button variant="secondary" size="sm" disabled={usage.isFetching} onClick={() => void usage.refetch()}>
          <RefreshCw className={usage.isFetching ? "size-4 animate-spin" : "size-4"} />{uiText("Refresh")}</Button>
      </div>
      {usage.isError && <p role="alert" className="text-sm text-destructive">{usage.error.message}</p>}
      {usage.data && <>
        <div className="flex h-8 overflow-hidden rounded-lg bg-muted" role="img" aria-label={uiText("Storage usage by category")}>
          {usage.data.categories.filter(item => item.bytes > 0).map(item => <div key={item.key} className={`basis-0 ${storageCategories[item.key][1]}`}
            style={{ flexGrow: item.bytes }} title={`${uiText(storageCategories[item.key][0])}: ${storageSize(item.bytes)}`} />)}
        </div>
        <dl className="flex flex-nowrap gap-6 overflow-x-auto pb-2">{usage.data.categories.map(item => <div key={item.key} className="flex shrink-0 flex-col gap-1 whitespace-nowrap">
          <dt className="flex items-center gap-2 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${storageCategories[item.key][1]}`} />{uiText(storageCategories[item.key][0])}</dt>
          <dd className="font-mono text-sm">{storageSize(item.bytes)}</dd>
        </div>)}</dl>
        <p className="break-all font-mono text-xs text-muted-foreground">{usage.data.rootPath}</p>
        {!usage.data.complete && <p role="status" className="text-sm text-muted-foreground">{uiText("Some paths were unreadable or the scan reached its limit. Refresh to retry; values are a lower bound.")}</p>}
      </>}
    </section>
    <section className="divide-y rounded-lg border bg-card">
      {managementLinks.map(item => <div key={item.path} className="flex items-center gap-4 p-4">
        <item.icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-1"><h2 className="text-sm font-medium">{uiText(item.title)}</h2>
          <p className="text-sm text-muted-foreground">{uiText(item.description)}</p></div>
        <Button size="sm" variant="secondary" asChild><Link to={item.path}>{uiText("Manage")}</Link></Button>
      </div>)}
    </section>
    {usage.data && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{uiText("Inventory scope and measurement")}</summary>
      <div className="flex flex-col gap-2 py-3"><p>{uiText("Logical file sizes, 1 GB = 1,000,000,000 bytes. Overlapping paths count once. Symlink targets and remote storage are excluded; file size is not reclaimable disk space.")}</p>
        <p>{uiText("Measured {{value0}}. Results are cached for 30 seconds.", { value0: formatDateTime(usage.data.measuredAt) })}</p>
        {!usage.data.roots?.some(root => root.category === "releases") && <p>{uiText("Installation resources are not registered by this startup method. Restart through the updated local launcher to include them.")}</p>}
        {usage.data.roots?.map(root => <p key={`${root.category}:${root.path}`} className="break-all font-mono">{root.path}</p>)}
      </div></details>}
  </div>;
}
