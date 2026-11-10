import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FolderOpen, Loader2, Search, Trash2 } from "lucide-react";
import type { Issue, ArchivedChatCleanupPreview, ArchivedChatCleanupResult } from "@paperclipai/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { authApi } from "@/api/auth";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { uiText, useUiLocale } from "@/i18n/ui";
import { invalidateInboxIssueQueries } from "@/lib/inboxArchiveCache";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { formatBytes } from "@/lib/issue-output";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 50;

export function ArchivedChats() {
  const { selectedCompanyId } = useCompany();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession });
  if (session.isError) return <p role="alert">{uiText("Unable to load archived chats.")}</p>;
  if (!selectedCompanyId) return <p>{uiText("Select an organization first.")}</p>;
  return <ArchivedChatsContent key={`${selectedCompanyId}:${session.data?.user.id ?? "local"}`}
    companyId={selectedCompanyId} userId={session.data?.user.id} ready={!session.isPending && !session.isError} />;
}

function ArchivedChatsContent({ companyId, userId, ready }: { companyId: string; userId?: string; ready: boolean }) {
  const locale = useUiLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("all");
  const [target, setTarget] = useState<Issue | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipRelated, setSkipRelated] = useState(true);
  const [batchResult, setBatchResult] = useState<ArchivedChatCleanupResult | null>(null);
  const [preview, setPreview] = useState<ArchivedChatCleanupPreview | null>(null);
  const previewAction = useMutation({
    mutationFn: (input: { issueIds: string[] } | { filters: { q?: string; projectId?: string } }) => issuesApi.previewArchivedChatCleanup(companyId, { ...input, skipRelated }),
    onMutate: () => { setActionError(null); setBatchResult(null); },
    onSuccess: setPreview,
    onError: (error) => setActionError(error instanceof Error ? uiText(error.message) : uiText("The action failed. Please try again.")),
  });
  const singlePreview = useQuery({ queryKey: ["archived-chat-deletion-preview", companyId, target?.id],
    queryFn: () => issuesApi.previewArchivedChatCleanup(companyId, { issueIds: [target!.id], skipRelated: false }),
    enabled: !!target, staleTime: 0, retry: false });
  const batchDelete = useMutation({
    mutationFn: () => issuesApi.cleanupArchivedChats(companyId, { issueIds: preview!.items
      .filter((item) => item.protection === "candidate").map((item) => item.id), skipRelated: preview!.skipRelated, confirm: true }),
    onMutate: () => setActionError(null),
    onSuccess: (result) => {
      setBatchResult(result);
      const deleted = new Set(result.items.filter((item) => item.status === "deleted").map((item) => item.id));
      setSelected((current) => new Set([...current].filter((id) => !deleted.has(id))));
      for (const id of deleted) client.removeQueries({ queryKey: queryKeys.issues.detail(id) });
    },
    onError: (error) => setActionError(error instanceof Error ? uiText(error.message) : uiText("The action failed. Please try again.")),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["archived-chats", companyId] });
      void invalidateInboxIssueQueries(client, companyId);
      void client.invalidateQueries({ queryKey: ["agent-chats", companyId] });
      void client.invalidateQueries({ queryKey: ["agent-chat", companyId] });
      void client.invalidateQueries({ queryKey: ["instance-storage"] });
    },
  });
  const candidates = preview?.items.filter((item) => item.protection === "candidate") ?? [];
  useEffect(() => { setSelected(new Set()); setPreview(null); }, [query, projectId]);
  useEffect(() => { setPreview(null); setBatchResult(null); }, [skipRelated]);
  useEffect(() => { setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" }, { label: uiText("Archived chats") }]); }, [setBreadcrumbs, locale]);
  const chats = useInfiniteQuery({
    queryKey: ["archived-chats", companyId, userId, query, projectId],
    queryFn: ({ pageParam }) => issuesApi.listArchivedChats(companyId, {
      q: query, projectId: projectId === "all" ? undefined : projectId, offset: pageParam, limit: PAGE_SIZE,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: ready,
  });
  const projects = useQuery({ queryKey: queryKeys.projects.list(companyId, { includeArchived: true }),
    queryFn: () => projectsApi.list(companyId, { includeArchived: true }) });
  const action = useMutation({
    mutationFn: async ({ task, remove }: { task: Issue; remove: boolean }) => {
      if (remove) await issuesApi.deleteArchivedChat(task.id);
      else await issuesApi.unarchiveFromInbox(task.id);
    },
    onMutate: () => setActionError(null),
    onSuccess: (_result, { task, remove }) => {
      setTarget(null);
      setSelected((current) => { const next = new Set(current); next.delete(task.id); return next; });
      void client.invalidateQueries({ queryKey: ["archived-chats", companyId] });
      void invalidateInboxIssueQueries(client, companyId);
      void client.invalidateQueries({ queryKey: ["agent-chats", companyId] });
      void client.invalidateQueries({ queryKey: ["agent-chat", companyId] });
      if (remove) client.removeQueries({ queryKey: queryKeys.issues.detail(task.id) });
      else void client.invalidateQueries({ queryKey: queryKeys.issues.detail(task.id) });
    },
    onError: (error) => setActionError(error instanceof Error ? uiText(error.message) : uiText("The action failed. Please try again.")),
  });
  const busy = previewAction.isPending || batchDelete.isPending || action.isPending;
  const rows = chats.data?.pages.flat() ?? [];
  const groups = new Map<string, Issue[]>();
  for (const row of rows) {
    const group = row.projectId ?? "none";
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
    <header className="flex flex-col gap-2">
      <h1 className="flex items-center gap-2 text-lg font-semibold"><Archive className="size-5 text-muted-foreground" />{uiText("Archived chats")}</h1>
      <p className="text-sm text-muted-foreground">{uiText("Manage conversations archived by you in this organization. Unarchiving does not resume execution.")}</p>
    </header>
    <form className="flex flex-wrap items-center gap-3" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}>
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder={uiText("Search archived chats")} aria-label={uiText("Search archived chats")} />
      </div>
      <Button type="submit" variant="secondary" disabled={busy}>{uiText("Search")}</Button>
      <SelectField className="w-full sm:w-auto" value={projectId} onValueChange={setProjectId} disabled={busy} aria-label={uiText("Project")}
        options={[{ value: "all", label: uiText("All projects") }, { value: "none", label: uiText("No project") },
          ...(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))]} />
    </form>
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <Button size="sm" variant="outline" disabled={!rows.length || busy}
        onClick={() => setSelected(selected.size ? new Set() : new Set(rows.slice(0, 200).map((row) => row.id)))}>
        {uiText(selected.size ? "Clear selection" : "Select loaded chats (up to 200)")}
      </Button>
      <span className="text-sm text-muted-foreground">{uiText("Selected {{value0}}", { value0: selected.size })}</span>
      <Button size="sm" variant="secondary" disabled={!selected.size || busy}
        onClick={() => previewAction.mutate({ issueIds: [...selected] })}><Trash2 className="size-4" />{uiText("Delete selected chats...")}</Button>
      <Button size="sm" variant="ghost" disabled={busy || chats.isPending || chats.isError}
        onClick={() => previewAction.mutate({ filters: { q: query, projectId: projectId === "all" ? undefined : projectId } })}>
        {uiText("Preview all filtered chats")}
      </Button>
      <label className="flex w-full items-center gap-2 text-sm"><Checkbox checked={skipRelated} disabled={busy}
        onCheckedChange={(checked) => setSkipRelated(checked === true)} />{uiText("Automatically exclude linked tasks")}</label>
      <p className="w-full text-xs text-muted-foreground">{uiText("Excludes parent links, dependencies and task references. Subtasks and active, paused or unfinished work always remain protected.")}</p>
    </div>
    {actionError && !target && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    {chats.isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border p-4">
      <p className="text-sm text-destructive">{uiText("Unable to load archived chats.")}</p>
      <Button variant="secondary" onClick={() => void chats.refetch()}>{uiText("Retry")}</Button>
    </div> : chats.isPending ? <p role="status" className="text-sm text-muted-foreground">{uiText("Loading...")}</p>
      : rows.length === 0 ? <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        <Archive className="size-6" /><p className="text-sm">{uiText(query || projectId !== "all" ? "No archived chats match these filters." : "No archived chats yet.")}</p>
      </div> : Array.from(groups, ([group, tasks]) => <section key={group} className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><FolderOpen className="size-4" />
          <span>{group === "none" ? uiText("No project") : projects.data?.find((project) => project.id === group)?.name ?? uiText("Project")}</span>
          <span className="ml-auto font-mono">{tasks.length}</span>
        </div>
        <div className="divide-y rounded-lg border bg-card">
          {tasks.map((task) => <div key={task.id} className="flex flex-wrap items-center gap-3 p-4">
            <Checkbox checked={selected.has(task.id)} aria-label={uiText("Select chat: {{value0}}", { value0: task.title })}
              disabled={busy || (!selected.has(task.id) && selected.size >= 200)} onCheckedChange={(checked) => setSelected((current) => {
                const next = new Set(current); if (checked === true) next.add(task.id); else next.delete(task.id); return next;
              })} />
            <div className="min-w-0 flex-1">
              <Link to={`/issues/${task.identifier ?? task.id}`} className="block truncate text-sm font-medium hover:underline">{task.title}</Link>
              <p className="font-mono text-xs text-muted-foreground">{task.identifier} · {formatDateTime(task.archivedAt ?? task.updatedAt)}</p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={uiText("Delete archived chat: {{value0}}", { value0: task.title })}
              disabled={busy} onClick={() => { setActionError(null); setTarget(task); }}><Trash2 className="size-4 text-muted-foreground" /></Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => action.mutate({ task, remove: false })}>
              <ArchiveRestore className="size-4" />{uiText("Unarchive")}
            </Button>
          </div>)}
        </div>
      </section>)}
    {chats.hasNextPage && <Button variant="outline" disabled={chats.isFetchingNextPage} onClick={() => void chats.fetchNextPage()}>{uiText("Load more")}</Button>}
    <AlertDialog open={!!preview} onOpenChange={(open) => { if (!open && !batchDelete.isPending) { setPreview(null); setBatchResult(null); } }}>
      <AlertDialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-2xl">
        <AlertDialogHeader><AlertDialogTitle>{uiText("Batch cleanup preview")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("Review the selected records and estimated space before confirming permanent deletion. Protected records are skipped. No data has been deleted by this preview.")}</AlertDialogDescription></AlertDialogHeader>
        <div className="flex flex-wrap gap-4 text-sm">
          <span>{uiText("Cleanup candidates: {{value0}}", { value0: preview?.items.filter((item) => item.protection === "candidate").length ?? 0 })}</span>
          <span>{uiText("Protected: {{value0}}", { value0: preview?.items.filter((item) => item.protection === "protected").length ?? 0 })}</span>
        </div>
        <p className="text-sm">{uiText("Estimated local files reclaimable: {{value0}}", { value0: formatBytes(candidates.reduce((sum, item) => sum + item.localAttachmentBytes, 0)) })}</p>
        <p className="text-xs text-muted-foreground">{uiText("Task and comment database records: approximately {{value0}} (reusable inside the database; not immediate disk recovery).", { value0: formatBytes(candidates.reduce((sum, item) => sum + item.databaseRecordBytes, 0)) })}</p>
        {batchResult && <div role="status" className="rounded-md border p-3 text-sm">
          <p>{uiText("Deleted {{value0}}; skipped or failed {{value1}}.", { value0: batchResult.items.filter((item) => item.status === "deleted").length,
            value1: batchResult.items.filter((item) => item.status !== "deleted").length })}</p>
          <p>{uiText("Estimated local files removed: {{value0}}", { value0: formatBytes(batchResult.estimatedLocalBytesRemoved) })}</p>
          {batchResult.items.filter((item) => item.status !== "deleted" || item.fileCleanupFailed).map((item) => <p key={item.id}>{preview?.items.find((row) => row.id === item.id)?.title ?? uiText("Unavailable record")}: {uiText(item.reason)}</p>)}
        </div>}
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        {candidates.length > 200 && <p className="text-sm text-muted-foreground">{uiText("Select at most 200 chats for one deletion batch.")}</p>}
        {preview?.truncated && <p className="text-sm text-muted-foreground">{uiText("Only the first 500 matching chats were previewed. Narrow the filters for the remainder.")}</p>}
        <div className="max-h-96 overflow-y-auto divide-y">
          {preview?.items.map((item) => <div key={item.id} className="flex flex-col gap-1 py-3">
            <p className="text-sm font-medium">{item.title ?? uiText("Unavailable record")}</p>
            <p className="text-xs text-muted-foreground"><span className="font-mono">{item.identifier}</span> · {uiText(item.protection === "candidate" ? "Cleanup candidate" : "Protected")}</p>
            <p className="text-xs text-muted-foreground">{uiText(item.reason)}</p>
          </div>)}
          {preview && !preview.items.length && <p className="py-3 text-sm text-muted-foreground">{uiText("No archived chats match these filters.")}</p>}
        </div>
        <p className="text-xs text-muted-foreground">{uiText("This permanently deletes the task record, comments, documents and attachments for everyone. Local project files are not deleted. This cannot be undone.")}</p>
        <p className="text-xs text-muted-foreground">{uiText("Space estimates use registered local attachment sizes; remote objects, retained run logs, backups and indexes are excluded. File deletion may fail, and actual disk recovery can differ.")}</p>
        <AlertDialogFooter className="sm:justify-between"><AlertDialogCancel disabled={batchDelete.isPending}>{uiText("Close preview")}</AlertDialogCancel>
          {!batchResult && <Button variant="destructive" disabled={!candidates.length || candidates.length > 200 || batchDelete.isPending}
            onClick={() => batchDelete.mutate()}>{batchDelete.isPending && <Loader2 className="size-4 animate-spin" />}{uiText("Permanently delete {{value0}} chats", { value0: candidates.length })}</Button>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !action.isPending) setTarget(null); }}>
      <AlertDialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-2xl">
        <AlertDialogHeader><AlertDialogTitle>{uiText("Permanently delete this chat and task?")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("This permanently deletes the task record, comments, documents and attachments for everyone. Local project files are not deleted. This cannot be undone.")}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="break-words text-sm font-medium">{target?.title}</p>
        {singlePreview.isPending && <p className="text-sm">{uiText("Estimating cleanup space...")}</p>}
        {singlePreview.isError && <p role="alert" className="text-sm text-destructive">{uiText("Unable to estimate cleanup space. Reopen the preview to retry.")}</p>}
        {singlePreview.data && <>
          <p className="text-sm">{uiText("Estimated local files reclaimable: {{value0}}", { value0: formatBytes(singlePreview.data.items[0]?.protection === "candidate" ? singlePreview.data.items[0].localAttachmentBytes : 0) })}</p>
          <p className="text-xs text-muted-foreground">{uiText("Task and comment database records: approximately {{value0}} (reusable inside the database; not immediate disk recovery).", { value0: formatBytes(singlePreview.data.items[0]?.protection === "candidate" ? singlePreview.data.items[0].databaseRecordBytes : 0) })}</p>
        </>}
        <p className="text-sm text-muted-foreground">{uiText("Tasks with subtasks, unfinished work, or active or paused execution cannot be deleted here.")}</p>
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel disabled={busy}>{uiText("Cancel")}</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "destructive" })} disabled={busy || !singlePreview.data || singlePreview.isFetching}
            onClick={(event) => { event.preventDefault(); if (target) action.mutate({ task: target, remove: true }); }}>
            {action.isPending && <Loader2 className="size-4 animate-spin" />}{uiText("Delete permanently")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
