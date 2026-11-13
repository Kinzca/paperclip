import { getUiLocale } from "@/i18n/ui";
import { CleanupFeedbackDialog, type CleanupFeedbackState } from "@/components/CleanupFeedbackDialog";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FolderOpen, Loader2, Search, Trash2 } from "lucide-react";
import type { Issue, ArchivedChatCleanupPreview, ArchivedChatCleanupJob, ArchivedChatCleanupResult } from "@paperclipai/shared";
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
  useUiLocale();
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
  const [retryTarget, setRetryTarget] = useState<ArchivedChatCleanupJob | null>(null);
  const [skipRelated, setSkipRelated] = useState(true);
  const [feedback, setFeedback] = useState<CleanupFeedbackState | null>(null);
  const [allSelected, setAllSelected] = useState(false);
  const [selectionItems, setSelectionItems] = useState<ArchivedChatCleanupPreview["items"]>([]);
  const [preview, setPreview] = useState<ArchivedChatCleanupPreview | null>(null);
  const previewAction = useMutation({
    mutationFn: (input: { issueIds: string[] }) => issuesApi.previewArchivedChatCleanupSelection(companyId, { ...input, skipRelated }),
    onMutate: () => setActionError(null),
    onSuccess: setPreview,
    onError: (error) => setActionError(error instanceof Error ? uiText(error.message) : uiText("The action failed. Please try again.")),
  });
  const singlePreview = useQuery({ queryKey: ["archived-chat-deletion-preview", companyId, target?.id],
    queryFn: () => issuesApi.previewArchivedChatCleanup(companyId, { issueIds: [target!.id], skipRelated: false }),
    enabled: !!target, staleTime: 0, retry: false });
  const batchDelete = useMutation({
    mutationFn: async () => {
      const confirmed = preview!;
      const ids = confirmed.items.filter(item => item.protection === "candidate").map(item => item.id);
      const result: ArchivedChatCleanupResult & { warning?: string } = { items: confirmed.items
        .filter(item => item.protection !== "candidate").map(item => ({ id: item.id, status: "skipped", reason: item.reason, fileCleanupFailed: false })), estimatedLocalBytesRemoved: 0 };
      for (let offset = 0; offset < ids.length; offset += 200) {
        const batch = ids.slice(offset, offset + 200);
        setFeedback({ phase: "cleaning", description: uiText("Processing {{value0}} of {{value1}} selected chats.", {
          value0: offset, value1: ids.length }) });
        try {
          const page = await issuesApi.cleanupArchivedChats(companyId, { issueIds: batch, skipRelated: confirmed.skipRelated, confirm: true });
          result.items.push(...page.items);
          result.estimatedLocalBytesRemoved += page.estimatedLocalBytesRemoved;
        } catch (error) {
          // Preserve confirmed earlier results. Never automatically repeat a deletion
          // whose response was lost, or continue later batches after that uncertainty.
          result.warning = uiText("Cleanup stopped because a batch result could not be confirmed. Refresh before retrying.");
          result.items.push(...ids.slice(offset).map((id, index) => ({ id, status: "failed" as const, fileCleanupFailed: false,
            reason: index < batch.length ? "Deletion result unavailable. Refresh before retrying." : "Not processed because cleanup stopped." })));
          break;
        }
      }
      return result;
    },
    onMutate: () => { setActionError(null); setFeedback({ phase: "cleaning" }); },
    onSuccess: (result) => {
      const attention = result.items.filter(item => item.status !== "deleted" || item.fileCleanupFailed).length;
      setFeedback({ phase: attention ? "partial" : "complete", completed: result.items.filter(item => item.status === "deleted").length, attention, warning: result.warning,
        metric: { label: uiText("Estimated local files removed"), value: formatBytes(result.estimatedLocalBytesRemoved) },
        details: result.items.map(item => ({ label: preview?.items.find(row => row.id === item.id)?.title ?? uiText("Unavailable record"),
          note: uiText(item.reason) })),
      });
      const deleted = new Set(result.items.filter((item) => item.status === "deleted").map((item) => item.id));
      setSelected((current) => new Set([...current].filter((id) => !deleted.has(id))));
      setAllSelected(false);
      for (const id of deleted) client.removeQueries({ queryKey: queryKeys.issues.detail(id) });
    },
    onError: (error) => setFeedback({ phase: "error", warning: error.message }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["archived-chat-eligibility", companyId] });
      void client.invalidateQueries({ queryKey: ["archived-chats", companyId] });
      void invalidateInboxIssueQueries(client, companyId);
      void client.invalidateQueries({ queryKey: ["agent-chats", companyId] });
      void client.invalidateQueries({ queryKey: ["agent-chat", companyId] });
      void client.invalidateQueries({ queryKey: ["instance-storage"] });
      void client.invalidateQueries({ queryKey: ["archived-chat-pending-files", companyId] });
    },
  });
  const candidates = preview?.items.filter((item) => item.protection === "candidate") ?? [];
  const excluded = preview?.items.filter((item) => item.protection !== "candidate") ?? [];
  const pendingFiles = useQuery({ queryKey: ["archived-chat-pending-files", companyId, userId],
    queryFn: () => issuesApi.pendingArchiveCleanup(companyId), enabled: ready, refetchOnWindowFocus: false, retry: false });
  const retryFiles = useMutation({
    mutationFn: (jobId: string) => issuesApi.retryArchiveCleanup(companyId, jobId),
    onMutate: () => { setActionError(null); setFeedback({ phase: "cleaning" }); },
    onSuccess: result => {
      const attention = result.files.filter(file => file.status !== "removed").length;
      setFeedback({ phase: attention ? "partial" : "complete", completed: result.files.length - attention, attention,
        metric: { label: uiText("Total files removed"), value: formatBytes(result.removedBytes) },
        details: result.files.map(file => ({ label: file.path, note: file.error ? uiText(file.error) : uiText(file.status === "removed" ? "Deleted" : "Pending file cleanup") })),
      });
      setRetryTarget(null);
    },
    onError: (error) => setFeedback({ phase: "error", warning: error.message }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["archived-chat-pending-files", companyId] });
      void client.invalidateQueries({ queryKey: ["instance-storage"] });
    },
  });
  useEffect(() => { setSelected(new Set()); setSelectionItems([]); setAllSelected(false); setPreview(null); }, [query, projectId]);
  useEffect(() => {
    setPreview(null); setAllSelected(false);
    if (skipRelated) {
      const linked = new Set([...selectionItems, ...(eligibility.data?.items ?? [])].filter(item => item.linked).map(item => item.id));
      setSelected(current => new Set([...current].filter(id => !linked.has(id))));
    }
  }, [skipRelated]);
  useEffect(() => { setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" }, { label: uiText("Storage"), href: "/company/settings/instance/storage" }, { label: uiText("Archived chats") }]); }, [setBreadcrumbs, locale, getUiLocale()]);
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
      if (remove) return issuesApi.deleteArchivedChat(task.id);
      return issuesApi.unarchiveFromInbox(task.id);
    },
    onMutate: ({ remove }) => { setActionError(null); if (remove) setFeedback({ phase: "cleaning" }); },
    onSuccess: (_result, { task, remove }) => {
      if (remove) {
        const pending = "fileCleanupFailed" in _result && _result.fileCleanupFailed;
        setFeedback({ phase: pending ? "partial" : "complete", title: uiText("Chat deleted"),
          description: uiText(pending ? "The chat was deleted. Some related files still need cleanup; review the unfinished file list." : "The chat and its task have been permanently deleted."),
          completed: 1, attention: pending ? 1 : 0, details: [{ label: task.title }],
        });
      }
      setTarget(null); setAllSelected(false);
      setSelected((current) => { const next = new Set(current); next.delete(task.id); return next; });
      void client.invalidateQueries({ queryKey: ["archived-chat-eligibility", companyId] });
      void client.invalidateQueries({ queryKey: ["archived-chats", companyId] });
      void invalidateInboxIssueQueries(client, companyId);
      void client.invalidateQueries({ queryKey: ["agent-chats", companyId] });
      void client.invalidateQueries({ queryKey: ["agent-chat", companyId] });
      if (remove) void client.invalidateQueries({ queryKey: ["archived-chat-pending-files", companyId] });
      if (remove) client.removeQueries({ queryKey: queryKeys.issues.detail(task.id) });
      else void client.invalidateQueries({ queryKey: queryKeys.issues.detail(task.id) });
    },
    onError: (error, { remove }) => {
      if (remove) setFeedback({ phase: "error", warning: error.message });
      else setActionError(uiText(error.message));
    },
  });
  const selectAll = useMutation({
    mutationFn: async () => {
      const records = await issuesApi.listAllArchivedChats(companyId, { q: query, projectId: projectId === "all" ? undefined : projectId });
      return issuesApi.previewArchivedChatCleanupSelection(companyId, { issueIds: records.map(item => item.id), skipRelated, includeFiles: false });
    },
    onMutate: () => setActionError(null),
    onSuccess: result => {
      setSelectionItems(result.items);
      setSelected(new Set(result.items.filter(item => !skipRelated || !item.linked).map(item => item.id)));
      setAllSelected(true);
    },
    onError: error => setActionError(uiText(error.message)),
  });
  const includeSubtasks = useMutation({
    mutationFn: async () => {
      const records = await issuesApi.listAllArchivedChats(companyId, {});
      const ids = new Set(preview!.items.map(item => item.id));
      const descendants = new Map<string, Issue[]>();
      for (const item of records) if (item.parentId) descendants.set(item.parentId, [...(descendants.get(item.parentId) ?? []), item]);
      const pending = [...ids];
      for (let index = 0; index < pending.length; index++) {
        for (const child of descendants.get(pending[index]) ?? []) {
          if (!ids.has(child.id)) { ids.add(child.id); pending.push(child.id); }
        }
      }
      return issuesApi.previewArchivedChatCleanupSelection(companyId, { issueIds: [...ids], skipRelated });
    },
    onMutate: () => setActionError(null),
    onSuccess: result => { setPreview(result); setSelected(new Set(result.items.map(item => item.id))); setAllSelected(false); },
    onError: error => setActionError(uiText(error.message)),
  });
  const busy = previewAction.isPending || batchDelete.isPending || action.isPending || retryFiles.isPending || selectAll.isPending || includeSubtasks.isPending;
  const rows = chats.data?.pages.flat() ?? [];
  const loadedIds = rows.map(row => row.id);
  const eligibility = useQuery({ queryKey: ["archived-chat-eligibility", companyId, userId, skipRelated, loadedIds.join(",")],
    queryFn: () => issuesApi.previewArchivedChatCleanupSelection(companyId, { issueIds: loadedIds, skipRelated, includeFiles: false }),
    enabled: ready && loadedIds.length > 0, staleTime: 0, retry: false });
  const eligibleItems = new Map(eligibility.data?.items.map((item) => [item.id, item]) ?? []);
  const excludedCount = (allSelected ? selectionItems : eligibility.data?.items ?? []).filter(item => skipRelated && item.linked).length;
  const selectionDisabled = busy || eligibility.isFetching || eligibility.isError || !eligibility.data;
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
    <form className="flex flex-wrap items-center gap-3" onSubmit={(event) => { event.preventDefault(); if (!busy) setQuery(search.trim()); }}>
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input className="pl-9" disabled={busy} value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder={uiText("Search archived chats")} aria-label={uiText("Search archived chats")} />
      </div>
      <Button type="submit" variant="secondary" disabled={busy}>{uiText("Search")}</Button>
      <SelectField className="w-full sm:w-auto" value={projectId} onValueChange={setProjectId} disabled={busy} aria-label={uiText("Project")}
        options={[{ value: "all", label: uiText("All projects") }, { value: "none", label: uiText("No project") },
          ...(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))]} />
    </form>
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <Button size="sm" variant="outline" disabled={busy || !ready || chats.isPending || chats.isError || !rows.length}
        onClick={() => { if (allSelected) { setSelected(new Set()); setAllSelected(false); } else selectAll.mutate(); }}>
        {selectAll.isPending && <Loader2 className="size-4 animate-spin" />}
        {uiText(selectAll.isPending ? "Selecting all chats..." : allSelected ? "Deselect all chats" : "Select all chats")}
      </Button>
      {!!selected.size && !allSelected && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>{uiText("Clear selection")}</Button>}
      <span className="text-sm text-muted-foreground">{uiText("Selected {{value0}}", { value0: selected.size })}</span>
      <Button size="sm" variant="secondary" disabled={!selected.size || busy}
        onClick={() => previewAction.mutate({ issueIds: [...selected] })}><Trash2 className="size-4" />{uiText("Delete selected chats...")}</Button>
      {excludedCount > 0 && <span className="text-xs text-muted-foreground">{uiText("Excluded {{value0}}", { value0: excludedCount })}</span>}
      <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-sm"><Checkbox checked={skipRelated} disabled={busy}
        onCheckedChange={(checked) => setSkipRelated(checked === true)} />{uiText("Automatically exclude linked tasks")}</label>
    </div>
    <p className="text-xs text-muted-foreground">{uiText("Select all chats matching the current search and project filters. Deletion eligibility is checked in the preview; active work must be stopped first.")}</p>
    {eligibility.isError && <p role="alert" className="text-sm text-destructive">{uiText("Unable to check cleanup eligibility. Selection is disabled; retry the check.")} <Button variant="ghost" size="sm" onClick={() => void eligibility.refetch()}>{uiText("Retry")}</Button></p>}
    {pendingFiles.isError && <p role="alert" className="text-sm text-destructive">{uiText("Unable to load pending file cleanup.")}</p>}
    {!!pendingFiles.data?.length && <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">{uiText("Unfinished file cleanup")}</h2>
      {pendingFiles.data.map((job) => <details key={job.id} className="text-sm">
        <summary>{job.title} · {job.files.filter((file) => file.status !== "removed").length}</summary>
        {job.files.filter((file) => file.status !== "removed").map((file) => <div key={file.path} className="py-2">
          <p className="break-all font-mono text-xs">{file.path}</p><p className="text-xs text-muted-foreground">{file.error ? uiText(file.error) : uiText("Pending file cleanup")}</p>
        </div>)}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setActionError(null); setRetryTarget(job); }}>{uiText("Review and retry file cleanup")}</Button>
      </details>)}
    </section>}
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
              disabled={selectionDisabled || (skipRelated && !!eligibleItems.get(task.id)?.linked)} onCheckedChange={(checked) => {
                setAllSelected(false);
                setSelected(current => { const next = new Set(current); if (checked === true) next.add(task.id); else next.delete(task.id); return next; });
              }} />
            <div className="min-w-0 flex-1">
              <Link to={`/issues/${task.identifier ?? task.id}`} className="block truncate text-sm font-medium hover:underline">{task.title}</Link>
              <p className="font-mono text-xs text-muted-foreground">{task.identifier} · {formatDateTime(task.archivedAt ?? task.updatedAt)}</p>
              {eligibleItems.get(task.id)?.protection === "protected" && <p className="text-xs text-muted-foreground">{uiText(eligibleItems.get(task.id)!.reason)}</p>}
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
    <AlertDialog open={!!preview && !feedback} onOpenChange={(open) => { if (!open && !busy) { setPreview(null); } }}>
      <AlertDialogContent className="flex max-h-(--sz-85vh) flex-col overflow-hidden sm:max-w-3xl">
        <div className="shrink-0 space-y-3">
          <AlertDialogHeader><AlertDialogTitle>{uiText("Batch cleanup preview")}</AlertDialogTitle>
            <AlertDialogDescription>{uiText("Delete the selected tasks and their verified exclusive files. Retained files are listed separately. This cannot be undone.")}</AlertDialogDescription></AlertDialogHeader>
          {!preview?.skipRelated && <Button size="sm" variant="outline" disabled={busy} onClick={() => includeSubtasks.mutate()}>
            {includeSubtasks.isPending && <Loader2 className="size-4 animate-spin" />}{uiText("Include archived subtasks and update preview")}
          </Button>}
          <p className="text-xs text-muted-foreground">{uiText("Unarchived or inaccessible subtasks are never added automatically. Cancel active work from its task page before retrying deletion.")}</p>
          <div className="flex flex-wrap gap-4 text-sm"><span>{uiText("Cleanup candidates: {{value0}}", { value0: candidates.length })}</span>
            <span>{uiText("Excluded {{value0}}", { value0: excluded.length })}</span></div>
          <p className="text-xs text-muted-foreground">{uiText("Only the listed tasks are included. Selected subtasks are deleted before their parents. Unselected subtasks and active execution keep a task protected.")}</p>
          <p className="text-sm font-medium">{uiText("Estimated local files reclaimable: {{value0}}", { value0: formatBytes(candidates.reduce((sum, item) => sum + item.filePlan.localBytes, 0)) })}</p>
          <p className="text-xs text-muted-foreground">{uiText("Task and comment database records: approximately {{value0}} (reusable inside the database; not immediate disk recovery).", { value0: formatBytes(candidates.reduce((sum, item) => sum + item.databaseRecordBytes, 0)) })}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-y py-3">
          {candidates.map((item) => <div key={item.id} className="space-y-2 border-b pb-3">
            <p className="text-sm font-medium">{item.identifier} · {item.title}</p>
            {item.filePlan.files.map((file) => <div key={file.path} className="text-xs">
              <p className="break-all font-mono">{file.path}</p><p className="text-muted-foreground">{uiText(file.kind === "run_log" ? "Run log" : file.kind === "workspace" ? "Verified disposable worktree" : "Attachment")} · {formatBytes(file.bytes)}</p>
            </div>)}
            {!item.filePlan.files.length && <p className="text-xs text-muted-foreground">{uiText("No verified exclusive files to remove.")}</p>}
            {!!item.filePlan.retained.length && <details className="text-xs text-muted-foreground"><summary>{uiText("Retained files and directories ({{value0}})", { value0: item.filePlan.retained.length })}</summary>
              {item.filePlan.retained.map((file, index) => <div key={`${file.path}:${index}`} className="py-2"><p className="break-all font-mono">{file.path}</p><p>{uiText(file.reason)}</p></div>)}
            </details>}
          </div>)}
          {!!excluded.length && <details className="text-xs text-muted-foreground"><summary>{uiText("Excluded records ({{value0}})", { value0: excluded.length })}</summary>
            {excluded.map((item) => <p key={item.id} className="py-2">
              {item.title ? <Link className="hover:underline" to={`/issues/${item.identifier ?? item.id}`}>{item.title}</Link> : uiText("Unavailable record")} · {uiText(item.reason)}</p>)}
          </details>}
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
          <p className="text-xs text-muted-foreground">{uiText("Only registered exclusive attachments, terminal run logs and verified disposable worktrees are removed. Shared project source, deliverables, backups and unregistered files are retained. Failed file cleanup remains available for retry.")}</p>
        </div>
        <AlertDialogFooter className="shrink-0 sm:justify-between"><AlertDialogCancel disabled={busy}>{uiText("Close preview")}</AlertDialogCancel>
          <Button variant="destructive" disabled={!candidates.length || busy}
            onClick={() => batchDelete.mutate()}>{batchDelete.isPending && <Loader2 className="size-4 animate-spin" />}{uiText("Permanently delete {{value0}} chats", { value0: candidates.length })}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!retryTarget && !feedback} onOpenChange={(open) => { if (!open && !retryFiles.isPending) setRetryTarget(null); }}>
      <AlertDialogContent className="flex max-h-(--sz-85vh) flex-col overflow-hidden sm:max-w-2xl">
        <AlertDialogHeader className="shrink-0"><AlertDialogTitle>{uiText("Retry file cleanup?")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("Only the previously confirmed files below will be retried. Files changed or shared since confirmation are retained.")}</AlertDialogDescription></AlertDialogHeader>
        <p className="shrink-0 text-sm font-medium">{uiText("Estimated local files reclaimable: {{value0}}", { value0: formatBytes(retryTarget?.files.filter((file) => file.status !== "removed").reduce((sum, file) => sum + file.bytes, 0) ?? 0) })}</p>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {retryTarget?.files.filter((file) => file.status !== "removed").map((file) => <p key={file.path} className="break-all font-mono text-xs">{file.path} · {formatBytes(file.bytes)}</p>)}
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        </div>
        <AlertDialogFooter className="shrink-0 sm:justify-between"><AlertDialogCancel disabled={retryFiles.isPending}>{uiText("Cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={retryFiles.isPending} onClick={() => retryTarget && retryFiles.mutate(retryTarget.id)}>{uiText("Confirm file cleanup")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!target && !feedback} onOpenChange={(open) => { if (!open && !action.isPending) setTarget(null); }}>
      <AlertDialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-2xl">
        <AlertDialogHeader><AlertDialogTitle>{uiText("Permanently delete this chat and task?")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("This permanently deletes the task, comments and documents and cleans the verified exclusive files listed below. Shared project originals and retained files are preserved. This cannot be undone.")}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="break-words text-sm font-medium">{target?.title}</p>
        {singlePreview.isPending && <p className="text-sm">{uiText("Estimating cleanup space...")}</p>}
        {singlePreview.data?.items[0]?.protection === "protected" && <p className="text-sm text-muted-foreground">{uiText(singlePreview.data.items[0].reason)}</p>}
        {singlePreview.isError && <p role="alert" className="text-sm text-destructive">{uiText("Unable to estimate cleanup space. Reopen the preview to retry.")}</p>}
        {singlePreview.data && <>
          <p className="text-sm">{uiText("Estimated local files reclaimable: {{value0}}", { value0: formatBytes(singlePreview.data.items[0]?.protection === "candidate" ? singlePreview.data.items[0].filePlan.localBytes : 0) })}</p>
          <p className="text-xs text-muted-foreground">{uiText("Task and comment database records: approximately {{value0}} (reusable inside the database; not immediate disk recovery).", { value0: formatBytes(singlePreview.data.items[0]?.protection === "candidate" ? singlePreview.data.items[0].databaseRecordBytes : 0) })}</p>
        </>}
        {singlePreview.data?.items[0]?.filePlan && <div className="space-y-2">
          {singlePreview.data.items[0].filePlan.files.map((file) => <p key={file.path} className="break-all font-mono text-xs">{file.path} · {formatBytes(file.bytes)}</p>)}
          {!!singlePreview.data.items[0].filePlan.retained.length && <details className="text-xs text-muted-foreground"><summary>{uiText("Retained files and directories ({{value0}})", { value0: singlePreview.data.items[0].filePlan.retained.length })}</summary>
            {singlePreview.data.items[0].filePlan.retained.map((file, index) => <p key={index} className="break-all py-1">{file.path} · {uiText(file.reason)}</p>)}
          </details>}
          <p className="text-xs text-muted-foreground">{uiText("Only registered exclusive attachments, terminal run logs and verified disposable worktrees are removed. Shared project source, deliverables, backups and unregistered files are retained. Failed file cleanup remains available for retry.")}</p>
        </div>}
        <p className="text-sm text-muted-foreground">{uiText("Unselected subtasks, unfinished work, or active or paused execution prevent deletion. Finish or cancel the affected tasks first.")}</p>
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel disabled={busy}>{uiText("Cancel")}</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "destructive" })} disabled={busy || !singlePreview.data || singlePreview.isFetching || singlePreview.data.items[0]?.protection !== "candidate"}
            onClick={(event) => { event.preventDefault(); if (target) action.mutate({ task: target, remove: true }); }}>
            {action.isPending && <Loader2 className="size-4 animate-spin" />}{uiText("Delete permanently")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <CleanupFeedbackDialog state={feedback} onClose={() => {
      setFeedback(null); setPreview(null); setTarget(null); setRetryTarget(null); setActionError(null);
    }} />
  </div>;
}
