import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, FolderOpen, RefreshCw, ShieldCheck } from "lucide-react";
import type { ProjectSpaceUsage } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { uiText, useUiLocale } from "@/i18n/ui";
import { storageSize as formatBytes } from "@/lib/storage";
import { Link } from "@/lib/router";
import { formatDateTime } from "@/lib/utils";

const kinds = { source: "Source and original assets", deliverables: "Deliverables", build: "Build output",
  dependencies: "Dependencies", cache: "Cache", temporary: "Temporary files", other: "Unclassified" } as const;
const levels = { protected: "Protected", rebuildable: "Rebuildability needs review", candidate: "Cleanup candidate" } as const;
const statuses = { measured: "Measured", partial: "Partial inventory", missing: "Directory not found",
  unavailable: "Unavailable or linked directory", covered: "Already included in parent directory" } as const;
type ProjectUsage = ProjectSpaceUsage["projects"][number];

export function ProjectSpaceSettings() {
  const { selectedCompanyId } = useCompany();
  return <ProjectSpaceContent key={selectedCompanyId} initialCompanyId={selectedCompanyId ?? ""} />;
}

function ProjectSpaceContent({ initialCompanyId }: { initialCompanyId: string }) {
  const locale = useUiLocale();
  const { companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [projectId, setProjectId] = useState("all");
  const [preview, setPreview] = useState<ProjectUsage | null>(null);
  useEffect(() => { setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" }, { label: uiText("Storage"), href: "/company/settings/instance/storage" }, { label: uiText("Company and project space") }]); }, [locale, setBreadcrumbs]);
  const usage = useQuery({ queryKey: ["project-space", companyId, true], queryFn: () => instanceSettingsApi.getProjectSpaceUsage(companyId, true),
    enabled: !!companyId, staleTime: 30_000, refetchOnWindowFocus: false, retry: false });
  const visible = (usage.data?.projects ?? []).filter((project) => projectId === "all" || project.id === projectId);
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
    <header className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="size-5 text-muted-foreground" />{uiText("Company and project space")}</h1>
      <p className="text-sm text-muted-foreground">{uiText("Company → project → registered directory. Inspect local usage and protection before planning cleanup.")}</p>
    </header>
    <div className="flex flex-wrap items-center gap-3">
      <SelectField className="w-full sm:w-auto" value={companyId} aria-label={uiText("Company")}
        onValueChange={(value) => { setCompanyId(value); setProjectId("all"); setPreview(null); }}
        options={(companies ?? []).map((company) => ({ value: company.id, label: company.name }))} />
      <SelectField className="w-full sm:w-auto" value={projectId} onValueChange={setProjectId} aria-label={uiText("Project")}
        options={[{ value: "all", label: uiText("All projects") }, ...(usage.data?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))]} />
      <Button className="sm:ml-auto" size="sm" variant="secondary" disabled={usage.isFetching || !companyId} onClick={() => void usage.refetch()}>
        <RefreshCw className={usage.isFetching ? "size-4 animate-spin" : "size-4"} />{uiText("Refresh")}
      </Button>
    </div>
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm">
      <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4" />{uiText("Read-only cleanup preview")}</p>
      <p className="text-muted-foreground">{uiText("Protected: source, original assets, deliverables, shared paths and active work. Rebuildability needs review: inferred caches or build output. Cleanup candidates require verified temporary ownership and no references; none are inferred from names alone.")}</p>
    </div>
    {usage.isError && <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
      <p>{uiText("Unable to load project space. Instance administrator access is required.")}</p>
      <Button className="self-start" size="sm" variant="outline" onClick={() => void usage.refetch()}>{uiText("Retry")}</Button>
    </div>}
    {usage.isPending && companyId && <p role="status" className="text-sm text-muted-foreground">{uiText("Measuring registered project directories...")}</p>}
    {usage.data && <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-lg border p-4"><span className="text-sm text-muted-foreground">{uiText("Exclusive project space")}</span><strong className="font-mono">{!usage.data.complete && uiText("At least ")}{formatBytes(usage.data.exclusiveBytes)}</strong></div>
        <div className="flex flex-col gap-1 rounded-lg border p-4"><span className="text-sm text-muted-foreground">{uiText("Shared project paths (deduplicated)")}</span><strong className="font-mono">{!usage.data.complete && uiText("At least ")}{formatBytes(usage.data.sharedBytes)}</strong></div>
        <div className="flex flex-col gap-1 rounded-lg border p-4"><span className="text-sm text-muted-foreground">{uiText("Registered projects")}</span><strong className="font-mono">{usage.data.projects.length}</strong></div>
      </div>
      {!usage.data.complete && <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-muted-foreground">{uiText("Partial scan or unavailable paths. Displayed file sizes are a lower bound, not zero usage for missing directories.")}</p>
        <p className="w-full text-xs text-muted-foreground">{uiText("Full inventory is enabled by default. Missing, unreadable or very large directories may still produce a partial result.")}</p>
      </div>}
      <p className="text-xs text-muted-foreground">{uiText("Measured {{value0}}", { value0: formatDateTime(usage.data.measuredAt) })}</p>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">{uiText("No registered projects match this selection.")}</p>}
      {visible.map((project) => <details key={project.id} className="rounded-lg border bg-card" open={visible.length === 1}>
        <summary className="cursor-pointer p-4 text-sm font-medium">
          {project.name}<span className="ml-3 font-mono text-muted-foreground">{!project.roots.length ? uiText("No local directory registered")
            : <>{project.roots.some((root) => !["measured", "covered"].includes(root.status)) && uiText("At least ")}{formatBytes(project.exclusiveBytes)}{uiText(" exclusive")} · {formatBytes(project.sharedBytes)}{uiText(" shared")}</>}</span>
        </summary>
        <div className="flex flex-col gap-4 border-t p-4">
          {project.activeOrPaused && <p className="text-sm text-muted-foreground">{uiText("Unfinished or paused work protects this project's files.")}</p>}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{uiText("Registered attachment bytes: {{value0}}", { value0: formatBytes(project.registeredAttachmentBytes) })}</span>
            <span>{uiText("Registered run-log bytes: {{value0}}", { value0: formatBytes(project.registeredLogBytes) })}</span>
            <Button className="sm:ml-auto" size="sm" variant="secondary" onClick={() => setPreview(project)}>{uiText("Preview cleanup protection")}</Button>
          </div>
          {!project.roots.length && <p className="text-sm text-muted-foreground">{uiText("No local directory registered. Nothing was scanned; this does not mean zero usage.")}</p>}
          {project.roots.map((root) => <div key={root.path} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <FolderOpen className="size-4" /><span className="break-all font-mono">{root.path}</span>
              <span>{uiText(statuses[root.status])}</span>
              {root.shared && <span>{uiText("Shared; do not add this path to each project total.")}</span>}
              {["measured", "partial"].includes(root.status) && <span className="font-mono">{root.status === "partial" && uiText("At least ")}{formatBytes(root.bytes)}</span>}
            </div>
            <div className="divide-y rounded-md border">
              {root.directories.map((directory) => <div key={directory.path} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1 break-all font-mono">{directory.name}</span>
                <span className="text-xs text-muted-foreground">{uiText(kinds[directory.kind])}</span>
                <span className="rounded-md bg-muted px-2 py-1 text-xs" title={uiText(directory.reason)}>{uiText(levels[directory.protection])}</span>
                <span className="font-mono">{directory.complete ? formatBytes(directory.bytes) : directory.bytes > 0
                  ? uiText("At least {{value0}}", { value0: formatBytes(directory.bytes) }) : uiText("Not fully measured")}</span>
              </div>)}
            </div>
          </div>)}
        </div>
      </details>)}
      <p className="text-xs text-muted-foreground">{uiText("Unattributed registered resources: attachments {{value0}}; run logs {{value1}}. These metadata values are not included in local directory totals.", {
        value0: formatBytes(usage.data.unattributedRegisteredAttachmentBytes), value1: formatBytes(usage.data.unattributedRegisteredLogBytes),
      })}</p>
    </>}
    <p className="text-xs text-muted-foreground">{uiText("Attachment and run-log values are registered metadata, excluded from local directory totals. Database and whole-instance backups remain shared instance storage; they are not apportioned to projects.")} <Link className="underline" to="/company/settings/instance/storage">{uiText("View instance storage")}</Link></p>
    <AlertDialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{uiText("Project cleanup preview")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("This preview never removes files. Rebuildability and unreferenced status must be verified before enabling cleanup.")}</AlertDialogDescription></AlertDialogHeader>
        <p className="text-sm font-medium">{preview?.name}</p>
        <p className="text-sm">{uiText("Estimated local files reclaimable: 0 B (file cleanup is not enabled).")}</p>
        <div className="max-h-96 overflow-y-auto divide-y">
          {preview?.roots.flatMap((root) => root.directories.map((directory) => <div key={directory.path} className="flex flex-col gap-1 py-3">
            <p className="break-all font-mono text-xs">{directory.path}</p>
            <p className="text-sm">{uiText(levels[directory.protection])} · <span className="font-mono">{directory.complete ? formatBytes(directory.bytes)
              : directory.bytes > 0 ? uiText("At least {{value0}}", { value0: formatBytes(directory.bytes) }) : uiText("Not fully measured")}</span></p>
            <p className="text-xs text-muted-foreground">{uiText(directory.reason)}</p>
          </div>))}
          {preview && !preview.roots.some((root) => root.directories.length) && <p className="py-3 text-sm text-muted-foreground">{uiText("No measured directories are available for cleanup preview.")}</p>}
        </div>
        <p className="text-xs text-muted-foreground">{uiText("Read-only preview. No deletion action is available.")}</p>
        <AlertDialogFooter><AlertDialogCancel>{uiText("Close preview")}</AlertDialogCancel></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
