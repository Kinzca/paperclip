import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FolderOpen, Loader2, Search, Trash2 } from "lucide-react";
import type { Issue } from "@paperclipai/shared";
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
      void client.invalidateQueries({ queryKey: ["archived-chats", companyId] });
      void invalidateInboxIssueQueries(client, companyId);
      void client.invalidateQueries({ queryKey: ["agent-chats", companyId] });
      void client.invalidateQueries({ queryKey: ["agent-chat", companyId] });
      if (remove) client.removeQueries({ queryKey: queryKeys.issues.detail(task.id) });
      else void client.invalidateQueries({ queryKey: queryKeys.issues.detail(task.id) });
    },
    onError: (error) => setActionError(error instanceof Error ? uiText(error.message) : uiText("The action failed. Please try again.")),
  });
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
      <Button type="submit" variant="secondary">{uiText("Search")}</Button>
      <SelectField className="w-full sm:w-auto" value={projectId} onValueChange={setProjectId} aria-label={uiText("Project")}
        options={[{ value: "all", label: uiText("All projects") }, { value: "none", label: uiText("No project") },
          ...(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))]} />
    </form>
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
            <div className="min-w-0 flex-1">
              <Link to={`/issues/${task.identifier ?? task.id}`} className="block truncate text-sm font-medium hover:underline">{task.title}</Link>
              <p className="font-mono text-xs text-muted-foreground">{task.identifier} · {formatDateTime(task.archivedAt ?? task.updatedAt)}</p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={uiText("Delete archived chat: {{value0}}", { value0: task.title })}
              disabled={action.isPending} onClick={() => { setActionError(null); setTarget(task); }}><Trash2 className="size-4 text-muted-foreground" /></Button>
            <Button variant="secondary" size="sm" disabled={action.isPending} onClick={() => action.mutate({ task, remove: false })}>
              <ArchiveRestore className="size-4" />{uiText("Unarchive")}
            </Button>
          </div>)}
        </div>
      </section>)}
    {chats.hasNextPage && <Button variant="outline" disabled={chats.isFetchingNextPage} onClick={() => void chats.fetchNextPage()}>{uiText("Load more")}</Button>}
    <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !action.isPending) setTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{uiText("Permanently delete this chat and task?")}</AlertDialogTitle>
          <AlertDialogDescription>{uiText("This permanently deletes the task record, comments, documents and attachments for everyone. Local project files are not deleted. This cannot be undone.")}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="break-words text-sm font-medium">{target?.title}</p>
        <p className="text-sm text-muted-foreground">{uiText("Tasks with subtasks, unfinished work, or active or paused execution cannot be deleted here.")}</p>
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel disabled={action.isPending}>{uiText("Cancel")}</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "destructive" })} disabled={action.isPending}
            onClick={(event) => { event.preventDefault(); if (target) action.mutate({ task: target, remove: true }); }}>
            {action.isPending && <Loader2 className="size-4 animate-spin" />}{uiText("Delete permanently")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
