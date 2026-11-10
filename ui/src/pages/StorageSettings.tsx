import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Building2, FolderOpen, HardDrive, RefreshCw } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { uiText, useUiLocale } from "@/i18n/ui";
import { formatBytes } from "@/lib/issue-output";
import { Link } from "@/lib/router";
import { formatDateTime } from "@/lib/utils";

const categoryStyles = {
  database: { label: "Database", color: "bg-chart-1" },
  logs: { label: "Run logs", color: "bg-chart-2" },
  files: { label: "Attachments and files", color: "bg-chart-3" },
  companyProjects: { label: "Company project directories", color: "bg-primary" },
  workspaces: { label: "Managed workspaces", color: "bg-chart-4" },
  backups: { label: "Backups", color: "bg-chart-5" },
  other: { label: "Other instance data", color: "bg-muted" },
} as const;

export function StorageSettings() {
  const locale = useUiLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" }, { label: uiText("Storage") }]); }, [setBreadcrumbs, locale]);
  const usage = useQuery({ queryKey: ["instance-storage", expanded], queryFn: () => instanceSettingsApi.getStorageUsage(expanded),
    staleTime: 30_000, refetchOnWindowFocus: false, retry: false });
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
    <header className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-lg font-semibold"><HardDrive className="size-5 text-muted-foreground" />{uiText("Storage")}</h1>
      <p className="text-sm text-muted-foreground">{uiText("Local storage on the device hosting this Paperclip instance, across all organizations.")}</p>
    </header>
    <section className="flex flex-col gap-4" aria-busy={usage.isFetching}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{uiText("Instance storage")}</h2>
        <Button variant="secondary" size="sm" disabled={usage.isFetching} onClick={() => void usage.refetch()}>
          <RefreshCw className={usage.isFetching ? "size-4 animate-spin" : "size-4"} />{uiText("Refresh")}
        </Button>
      </div>
      {usage.isError && <p role="alert" className="text-sm text-destructive">{uiText("Unable to measure storage. Instance administrator access is required. Try refreshing or contact an administrator.")}</p>}
      {usage.isPending && <p role="status" className="text-sm text-muted-foreground">{uiText("Measuring local file sizes...")}</p>}
      {usage.data && <>
        <p className="text-sm font-medium">{uiText(usage.data.complete ? "Paperclip uses {{value0}}" : "Paperclip uses at least {{value0}}", { value0: formatBytes(usage.data.totalBytes) })}</p>
        <div className="flex h-8 overflow-hidden rounded-lg bg-muted" role="img" aria-label={uiText("Storage usage by category")}>
          {usage.data.categories.filter((category) => category.bytes > 0).map((category) => <div key={category.key}
            className={`basis-0 ${categoryStyles[category.key].color}`} style={{ flexGrow: category.bytes }}
            title={`${uiText(categoryStyles[category.key].label)}: ${formatBytes(category.bytes)}`} />)}
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {usage.data.categories.map((category) => <div key={category.key} className="flex flex-col gap-1">
            <dt className="flex items-center gap-2 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${categoryStyles[category.key].color}`} />{uiText(categoryStyles[category.key].label)}</dt>
            <dd className="font-mono text-sm">{usage.data.complete ? formatBytes(category.bytes) : category.bytes > 0
              ? uiText("At least {{value0}}", { value0: formatBytes(category.bytes) }) : uiText("Not fully measured")}</dd>
          </div>)}
        </dl>
        <p className="break-all font-mono text-xs text-muted-foreground">{usage.data.rootPath}</p>
        <p className="text-xs text-muted-foreground">{uiText("Measured {{value0}}. Results are cached for 30 seconds.", { value0: formatDateTime(usage.data.measuredAt) })}</p>
        {!usage.data.complete && <p role="status" className="text-sm text-muted-foreground">{uiText("Partial inventory: the scan reached its time or entry limit, or some paths were unreadable. Values are a lower bound.")}</p>}
        {!usage.data.complete && !expanded && <Button className="self-start" size="sm" variant="outline" onClick={() => setExpanded(true)}>{uiText("Expand inventory (read-only)")}</Button>}
        <p className="text-xs text-muted-foreground">{uiText("Includes {{value0}} registered company/project directories. Overlapping project and instance paths are counted only once.", { value0: usage.data.projectRootCount })}</p>
        <p className="text-xs text-muted-foreground">{uiText("Logical file sizes include instance data and registered local project directories. Symbolic links, unregistered folders, remote databases and cloud object storage are excluded. This does not measure reclaimable space.")}</p>
      </>}
    </section>
    <section className="divide-y rounded-lg border bg-card">
      <div className="flex items-center gap-4 p-4">
        <Building2 className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-1"><h2 className="text-sm font-medium">{uiText("Company and project space")}</h2>
          <p className="text-sm text-muted-foreground">{uiText("Inspect local directories by company and project, with cleanup protection levels.")}</p></div>
        <Button variant="secondary" size="sm" asChild><Link to="/company/settings/instance/project-space">{uiText("Manage")}</Link></Button>
      </div>
      <div className="flex items-center gap-4 p-4">
        <Archive className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-1"><h2 className="text-sm font-medium">{uiText("Archived chats")}</h2>
          <p className="text-sm text-muted-foreground">{uiText("Review, restore or permanently delete individual archived conversations.")}</p></div>
        <Button variant="secondary" size="sm" asChild><Link to="/company/settings/instance/archived-chats">{uiText("Manage")}</Link></Button>
      </div>
      <div className="flex items-center gap-4 p-4">
        <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-1"><h2 className="text-sm font-medium">{uiText("Managed workspaces")}</h2>
          <p className="text-sm text-muted-foreground">{uiText("Inspect workspaces and their tasks before deciding what to retain.")}</p></div>
        <Button variant="secondary" size="sm" asChild><Link to="/workspaces">{uiText("Manage")}</Link></Button>
      </div>
    </section>
    <p className="text-xs text-muted-foreground">{uiText("Storage inventory is read-only. Database files, backups, source code and active workspaces are not automatically cleaned.")}</p>
  </div>;
}
