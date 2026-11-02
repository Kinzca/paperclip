import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Circle, Plus, X } from "lucide-react";
import {
  workflowEvaluationSchema,
  workflowTemplateSchema,
  type WorkflowBaseline,
} from "@paperclipai/shared";
import { workflowsApi, type WorkflowConfiguration } from "@/api/workflows";
import { ApiError } from "@/api/client";
import { uiText, useUiLocale } from "@/i18n/ui";
import { Link } from "@/lib/router";
import { formatDateTime } from "@/lib/utils";
import type { WorkflowChoice } from "@/lib/workflow-presentation";
import {
  workflowNodeTitle,
  workflowTemplateText,
} from "@/lib/workflow-presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface DraftRequest {
  choice: WorkflowChoice;
  request: number;
}

export function WorkflowImprovements({
  companyId,
  accountId,
  config,
  request,
  onCreate,
}: {
  companyId: string;
  accountId: string | null;
  config: WorkflowConfiguration;
  request: DraftRequest | null;
  onCreate: () => void;
}) {
  const locale = useUiLocale();
  const client = useQueryClient();
  const cacheKey = [
    "workflow-editor-session",
    accountId,
    companyId,
    "revision",
  ];
  const cached = client.getQueryData<{
    definition: string;
    originalDefinition: string;
    rationale: string;
    base: WorkflowChoice | null;
    revisionId: string;
    step: string;
  }>(cacheKey);
  const [open, setOpen] = useState(!!cached);
  const [step, setStep] = useState(cached?.step ?? "draft");
  const [definition, setDefinition] = useState(cached?.definition ?? "");
  const [originalDefinition, setOriginalDefinition] = useState(
    cached?.originalDefinition ?? "",
  );
  const [base, setBase] = useState<WorkflowChoice | null>(cached?.base ?? null);
  const [replacement, setReplacement] = useState<DraftRequest | null>(null);
  const [pendingRevision, setPendingRevision] = useState<string | null>(null);
  const [rationale, setRationale] = useState(cached?.rationale ?? "");
  const [revisionId, setRevisionId] = useState(cached?.revisionId ?? "");
  const [validation, setValidation] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<WorkflowBaseline[]>([]);
  const [manual, setManual] = useState({
    baselineRunId: "",
    candidateRunId: "",
    scenarioKey: "",
  });
  const [manualInvalid, setManualInvalid] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const workspaceTabs = useRef<HTMLDivElement>(null);
  const drafts = config.revisions.filter((row) => row.status === "draft");
  const revision = config.revisions.find((row) => row.id === revisionId);
  const parsed = useMemo(() => {
    if (!definition) return { value: null, error: "" };
    // JSON text is an unknown external boundary; preserve it on parse failure.
    let value: unknown;
    try {
      value = JSON.parse(definition);
    } catch {
      return {
        value: null,
        error: uiText("Invalid JSON. Check quotes, commas and brackets."),
      };
    }
    const result = workflowTemplateSchema.safeParse(value);
    return result.success
      ? { value: result.data, error: "" }
      : {
          value: null,
          error: uiText(
            "Invalid workflow definition at {{path}}. Check the field and try again.",
            { path: result.error.issues[0].path.join(".") || "definition" },
          ),
        };
  }, [definition, locale]);
  const evaluations = useQuery({
    queryKey: ["workflow-evaluations", companyId, accountId, revisionId],
    queryFn: ({ signal }) =>
      workflowsApi.evaluations(companyId, revisionId, { signal }),
    enabled: open && !!revisionId,
    refetchInterval: open && step === "publish" && !!revisionId ? 10000 : false,
  });
  const baselines = useQuery({
    queryKey: [
      "workflow-baselines",
      companyId,
      accountId,
      revisionId,
      query,
      offset,
    ],
    queryFn: ({ signal }) =>
      workflowsApi.baselines(companyId, revisionId, query, offset, { signal }),
    enabled: open && step === "regressions" && revision?.status === "draft",
  });
  const refreshResults = () =>
    client.invalidateQueries({
      queryKey: ["workflow-evaluations", companyId, accountId, revisionId],
    });
  const propose = useMutation({
    mutationFn: (input: Parameters<typeof workflowsApi.propose>[1]) =>
      workflowsApi.propose(companyId, input),
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: ["workflows", companyId] });
      setRevisionId(saved.id);
      setSelected([]);
      setStep("regressions");
      setOriginalDefinition(definition);
      setRationale("");
    },
  });
  const trials = useMutation({
    mutationFn: (runIds: string[]) =>
      workflowsApi.trials(companyId, revisionId, runIds),
    onSuccess: async () => {
      await refreshResults();
      setStep("publish");
    },
  });
  const publish = useMutation({
    mutationFn: () => workflowsApi.publish(companyId, revisionId),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["workflows", companyId] }),
  });
  const evaluate = useMutation({
    mutationFn: (input: Parameters<typeof workflowsApi.evaluate>[2]) =>
      workflowsApi.evaluate(companyId, revisionId, input),
    onSuccess: refreshResults,
  });
  const busy =
    propose.isPending ||
    trials.isPending ||
    publish.isPending ||
    evaluate.isPending;
  const dirty =
    !!rationale.trim() || (!!definition && definition !== originalDefinition);
  useEffect(() => {
    client.setQueryDefaults(["workflow-editor-session"], { gcTime: Infinity });
    if (dirty)
      client.setQueryData(cacheKey, {
        definition,
        originalDefinition,
        rationale,
        base,
        revisionId,
        step,
      });
    else client.removeQueries({ queryKey: cacheKey, exact: true });
  }, [
    client,
    accountId,
    companyId,
    dirty,
    definition,
    originalDefinition,
    rationale,
    base,
    revisionId,
    step,
  ]);
  function prepare(next: DraftRequest) {
    setBase(next.choice);
    setDefinition(JSON.stringify(next.choice.definition, null, 2));
    setOriginalDefinition("");
    setRationale("");
    setValidation(false);
    setRevisionId("");
    setSelected([]);
    setReplacement(null);
    propose.reset();
    publish.reset();
    trials.reset();
    setOpen(true);
    setStep("draft");
    setOffset(0);
    setQuery("");
    setSearch("");
    setPendingRevision(null);
  }
  function chooseRevision(id: string) {
    const selectedDraft = drafts.find((item) => item.id === id);
    const baseRevision = config.revisions.find(
      (item) => item.id === selectedDraft?.basedOnRevisionId,
    );
    const json = selectedDraft
      ? JSON.stringify(selectedDraft.definition, null, 2)
      : "";
    setDefinition(json);
    setOriginalDefinition(json);
    setRationale("");
    setValidation(false);
    setBase(
      selectedDraft
        ? {
            definition: selectedDraft.definition,
            builtIn: false,
            revision: baseRevision?.revision ?? null,
          }
        : null,
    );
    setRevisionId(id);
    setSelected([]);
    setOffset(0);
    setQuery("");
    setSearch("");
    setManual({ baselineRunId: "", candidateRunId: "", scenarioKey: "" });
    setManualInvalid(false);
    trials.reset();
    publish.reset();
    evaluate.reset();
    propose.reset();
    setPendingRevision(null);
    setStep(id ? "regressions" : "draft");
  }
  useEffect(() => {
    if (!request) return;
    setOpen(true);
    if (dirty || busy) setReplacement(request);
    else prepare(request);
    // A request is an explicit user action; edits do not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  useEffect(() => {
    if (open && step === "draft") heading.current?.focus();
  }, [open, step, request]);
  useEffect(() => {
    if (open && step !== "draft")
      workspaceTabs.current
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
  }, [open, step]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const results = evaluations.data ?? [];
  const distinctPassed = new Set(
    results
      .filter((result) => result.passed)
      .map((result) => result.scenarioKey),
  ).size;
  const allPassed =
    results.length > 0 && results.every((result) => result.passed);
  const ready =
    !dirty && revision?.status === "draft" && distinctPassed >= 3 && allPassed;
  const selectedObjectives = new Set(
    selected.map((item) => item.objectiveFingerprint),
  );
  const canRun =
    !dirty &&
    revision?.status === "draft" &&
    selected.length >= 3 &&
    selected.length <= 10 &&
    selectedObjectives.size === selected.length;
  const title = (choice: WorkflowChoice) =>
    workflowTemplateText(choice, "name");
  const fixedGate =
    propose.error instanceof ApiError
      ? /(?:fixed|gate|dependencies): (.+)$/.exec(propose.error.message)?.[1]
      : undefined;

  return (
    <section
      className="flex flex-col gap-4 border-t border-border pt-6"
      aria-labelledby="workflow-revisions"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="workflow-revisions" className="text-base font-semibold">
            {uiText("Workflow revisions")}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {uiText(
              "Improve instructions, verify against successful tasks, then publish with evidence.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="workflow-revision-workspace"
          >
            <ChevronDown aria-hidden="true" />
            {uiText(
              open ? "Close revision workspace" : "Open revision workspace",
            )}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCreate}>
            <Plus aria-hidden="true" />
            {uiText("Create revision")}
          </Button>
        </div>
      </div>
      {open && (
        <div id="workflow-revision-workspace" className="flex flex-col gap-5">
          {dirty && step !== "draft" && (
            <p role="alert" className="text-sm text-destructive">
              {uiText(
                "Save the edited draft as a new revision before running regressions or publishing.",
              )}
            </p>
          )}
          {replacement && (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-lg border border-border p-4"
            >
              <p className="text-sm">
                {uiText(
                  "A draft is already being edited. Keep it or replace it with this template?",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setReplacement(null)}>
                  {uiText("Keep editing")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => prepare(replacement)}
                >
                  {uiText("Replace draft")}
                </Button>
              </div>
            </div>
          )}
          {pendingRevision !== null && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
            >
              <p className="text-sm">
                {uiText("Discard the unsaved draft to switch revisions?")}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setPendingRevision(null)}
                >
                  {uiText("Keep editing")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => chooseRevision(pendingRevision)}
                >
                  {uiText("Discard and switch")}
                </Button>
              </div>
            </div>
          )}
          <label className="flex max-w-xl flex-col gap-1.5 text-sm">
            {uiText("Select an existing draft")}
            <NativeSelect
              aria-label={uiText("Select an existing draft")}
              value={revisionId}
              disabled={busy}
              onChange={(event) =>
                dirty
                  ? setPendingRevision(event.target.value)
                  : chooseRevision(event.target.value)
              }
            >
              <option value="">{uiText("Select a draft")}</option>
              {drafts.map((item) => (
                <option key={item.id} value={item.id}>
                  {workflowTemplateText(
                    {
                      definition: item.definition,
                      builtIn: false,
                      revision: item.revision,
                    },
                    "name",
                  )}{" "}
                  · {uiText("Version {{version}}", { version: item.revision })}
                </option>
              ))}
            </NativeSelect>
            {drafts.length === 0 && (
              <span className="text-xs text-muted-foreground">
                {uiText("No saved drafts yet")}
              </span>
            )}
          </label>
          <Tabs ref={workspaceTabs} value={step} onValueChange={setStep}>
            <TabsList
              variant="line"
              className="h-auto max-w-full flex-wrap justify-start gap-2"
              aria-label={uiText("Workflow revisions")}
            >
              <TabsTrigger disabled={busy} value="draft">
                1 · {uiText("Edit draft")}
              </TabsTrigger>
              <TabsTrigger disabled={busy} value="regressions">
                2 · {uiText("Run regressions")}
              </TabsTrigger>
              <TabsTrigger disabled={busy} value="publish">
                3 · {uiText("Review and publish")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="draft" className="flex flex-col gap-4 pt-4">
              <h3
                ref={heading}
                tabIndex={-1}
                className="text-sm font-semibold outline-none"
              >
                {base ? title(base) : uiText("Draft instructions")}
              </h3>
              {definition ? (
                <form
                  noValidate
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setValidation(true);
                    if (!parsed.value || !rationale.trim()) return;
                    const basedOn = config.revisions.find(
                      (item) =>
                        item.status === "published" &&
                        item.templateKey === parsed.value!.key &&
                        item.revision === base?.revision,
                    );
                    propose.mutate({
                      definition: parsed.value,
                      rationale: rationale.trim(),
                      basedOnRevisionId: basedOn?.id ?? null,
                    });
                  }}
                >
                  <p role="status" className="text-sm text-muted-foreground">
                    {uiText(
                      revisionId
                        ? "Saved draft. Editing it creates a new draft revision."
                        : "Draft ready to edit. Nothing has been saved yet.",
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {uiText(
                      "Acceptance checks, review instructions and dependencies stay fixed. Change the execution instructions below.",
                    )}
                  </p>
                  <fieldset
                    disabled={busy}
                    className="flex min-w-0 flex-col gap-4"
                  >
                    {parsed.value?.nodes
                      .filter((node) => node.kind === "task")
                      .map((node) => (
                        <label
                          key={node.id}
                          className="flex min-w-0 flex-col gap-1.5 text-sm"
                        >
                          {uiText("Instructions for {{stage}}", {
                            stage: base
                              ? workflowNodeTitle(base, node)
                              : node.title,
                          })}
                          <Textarea
                            rows={3}
                            value={node.instructions}
                            onChange={(event) =>
                              setDefinition(
                                JSON.stringify(
                                  {
                                    ...parsed.value,
                                    nodes: parsed.value!.nodes.map((item) =>
                                      item.id === node.id
                                        ? {
                                            ...item,
                                            instructions: event.target.value,
                                          }
                                        : item,
                                    ),
                                  },
                                  null,
                                  2,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                    <label className="flex flex-col gap-1.5 text-sm">
                      {uiText("Why is this revision needed?")}
                      <Textarea
                        rows={2}
                        maxLength={4000}
                        value={rationale}
                        placeholder={uiText(
                          "Explain the problem this change solves.",
                        )}
                        aria-invalid={validation && !rationale.trim()}
                        aria-describedby="workflow-rationale-help"
                        onChange={(event) => setRationale(event.target.value)}
                      />
                    </label>
                    {validation && !rationale.trim() && (
                      <p
                        id="workflow-rationale-help"
                        className="text-sm text-destructive"
                      >
                        {uiText("Enter a reason for this revision.")}
                      </p>
                    )}
                    <details>
                      <summary className="cursor-pointer text-sm text-muted-foreground">
                        {uiText("Advanced JSON editor")}
                      </summary>
                      <label className="flex flex-col gap-2 pt-3 text-sm">
                        {uiText("Template definition")}
                        <Textarea
                          rows={12}
                          className="font-mono"
                          value={definition}
                          aria-invalid={!!parsed.error}
                          aria-describedby="workflow-definition-error"
                          onChange={(event) =>
                            setDefinition(event.target.value)
                          }
                        />
                      </label>
                    </details>
                  </fieldset>
                  {parsed.error && (
                    <p
                      id="workflow-definition-error"
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {parsed.error}
                    </p>
                  )}
                  {propose.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {fixedGate
                        ? uiText(
                            "Fixed verification rules cannot be changed: {{stage}}.",
                            {
                              stage:
                                parsed.value?.nodes.find(
                                  (node) => node.id === fixedGate,
                                )?.title ?? fixedGate,
                            },
                          )
                        : uiText(
                            "Could not save the draft. Your edits are preserved.",
                          )}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setDefinition("");
                        setOriginalDefinition("");
                        setRationale("");
                        setBase(null);
                      }}
                    >
                      {uiText("Discard changes")}
                    </Button>
                    <Button type="submit" disabled={busy}>
                      {uiText(
                        propose.isPending ? "Saving draft…" : "Save draft",
                      )}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col items-start gap-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    {uiText(
                      "Save a draft in the first step to select baseline tasks.",
                    )}
                  </p>
                  <Button variant="outline" onClick={onCreate}>
                    {uiText("Create revision")}
                  </Button>
                </div>
              )}
            </TabsContent>
            <TabsContent
              value="regressions"
              className="flex flex-col gap-4 pt-4"
            >
              {propose.isSuccess && (
                <p role="status" className="text-sm">
                  {uiText("Draft saved. Select baseline tasks to verify it.")}
                </p>
              )}
              {!revisionId ? (
                <p className="py-4 text-sm text-muted-foreground">
                  {uiText(
                    "Save a draft in the first step to select baseline tasks.",
                  )}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold">
                      {uiText(
                        "Select 3–10 tasks with different frozen objectives.",
                      )}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {uiText(
                        "Only successful runs of the matching baseline version are listed.",
                      )}
                    </p>
                  </div>
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setQuery(search);
                      setOffset(0);
                    }}
                  >
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="sr-only">
                        {uiText("Search successful tasks")}
                      </span>
                      <Input
                        maxLength={200}
                        value={search}
                        placeholder={uiText("Task title or identifier")}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <Button type="submit" variant="outline">
                      {uiText("Search")}
                    </Button>
                  </form>
                  {selected.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-medium text-muted-foreground">
                        {uiText("Selected baseline tasks")}
                      </h4>
                      <ul className="flex flex-wrap gap-2">
                        {selected.map((item) => (
                          <li key={item.id}>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-auto max-w-full whitespace-normal text-left"
                              aria-label={uiText("Remove {{title}}", {
                                title: item.objectiveTitle,
                              })}
                              onClick={() =>
                                setSelected(
                                  selected.filter((row) => row.id !== item.id),
                                )
                              }
                            >
                              {item.issueIdentifier} · {item.objectiveTitle}
                              <X
                                aria-hidden="true"
                                className="size-3 shrink-0"
                              />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p role="status" className="text-sm font-medium">
                    {uiText("{{count}} of 3 required objectives selected", {
                      count: selectedObjectives.size,
                    })}
                  </p>
                  {baselines.isPending && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {uiText("Loading...")}
                    </p>
                  )}
                  {baselines.error && (
                    <div
                      role="alert"
                      className="flex flex-col items-start gap-2 text-sm text-destructive"
                    >
                      <p>
                        {uiText(
                          "Could not load baseline tasks. Retry the search.",
                        )}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => void baselines.refetch()}
                      >
                        {uiText("Retry")}
                      </Button>
                    </div>
                  )}
                  {baselines.data?.items.length === 0 && (
                    <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-5">
                      <h4 className="text-sm font-medium">
                        {uiText("No eligible baseline tasks")}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {uiText(
                          "Complete successful tasks with this workflow first, or try another search. No tasks are started automatically.",
                        )}
                      </p>
                    </div>
                  )}
                  <ul className="divide-y divide-border">
                    {baselines.data?.items.map((item) => {
                      const checked = selected.some(
                        (row) => row.id === item.id,
                      );
                      const duplicate =
                        !checked &&
                        selectedObjectives.has(item.objectiveFingerprint);
                      return (
                        <li key={item.id}>
                          <label className="flex cursor-pointer items-start gap-3 py-3">
                            <Checkbox
                              className="mt-1"
                              checked={checked}
                              disabled={
                                busy ||
                                duplicate ||
                                (!checked && selected.length >= 10)
                              }
                              onCheckedChange={(checked) =>
                                setSelected((current) => {
                                  if (checked !== true)
                                    return current.filter(
                                      (row) => row.id !== item.id,
                                    );
                                  if (
                                    current.length >= 10 ||
                                    current.some(
                                      (row) =>
                                        row.objectiveFingerprint ===
                                        item.objectiveFingerprint,
                                    )
                                  )
                                    return current;
                                  return [...current, item];
                                })
                              }
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className="break-words text-sm font-medium">
                                {item.objectiveTitle}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                <span className="font-mono">
                                  {item.issueIdentifier}
                                </span>{" "}
                                ·{" "}
                                {uiText("Completed {{date}}", {
                                  date: formatDateTime(
                                    item.finishedAt ?? item.createdAt,
                                  ),
                                })}
                              </span>
                              {duplicate && (
                                <span className="text-xs text-muted-foreground">
                                  {uiText("This objective is already selected")}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {(offset > 0 || baselines.data?.hasMore) && (
                    <div className="flex justify-between gap-2">
                      <Button
                        variant="ghost"
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - 20))}
                      >
                        {uiText("Previous page")}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!baselines.data?.hasMore}
                        onClick={() => setOffset(offset + 20)}
                      >
                        {uiText("Next page")}
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-col gap-3 border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground">
                      {uiText(
                        "This starts real agent tasks and may incur usage costs. Existing budgets and workflow limits apply.",
                      )}
                    </p>
                    {trials.error && (
                      <p role="alert" className="text-sm text-destructive">
                        {uiText(
                          "Could not start regressions. Your selection is preserved.",
                        )}
                      </p>
                    )}
                    <div className="flex justify-end">
                      <Button
                        disabled={!canRun || busy}
                        onClick={() =>
                          trials.mutate(selected.map((item) => item.id))
                        }
                      >
                        {trials.isPending
                          ? uiText("Starting regressions…")
                          : uiText("Start {{count}} candidate tasks", {
                              count: selected.length,
                            })}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value="publish" className="flex flex-col gap-4 pt-4">
              {trials.isSuccess && (
                <p role="status" className="text-sm">
                  {uiText(
                    "Candidate tasks started. Results update automatically.",
                  )}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {uiText("Regression results")}
                </h3>
                {revisionId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void evaluations.refetch()}
                  >
                    {uiText("Refresh results")}
                  </Button>
                )}
              </div>
              {evaluations.error && (
                <p role="alert" className="text-sm text-destructive">
                  {evaluations.error.message}
                </p>
              )}
              {results.length === 0 ? (
                <div className="flex flex-col gap-1 py-4">
                  <h4 className="text-sm font-medium">
                    {uiText("No regression results yet")}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {uiText(
                      "Start regressions in the previous step, then review their evidence here.",
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 font-medium">
                          {uiText("Objective")}
                        </th>
                        <th className="p-2 font-medium">
                          {uiText("Baseline task")}
                        </th>
                        <th className="p-2 font-medium">
                          {uiText("Candidate task")}
                        </th>
                        <th className="p-2 font-medium">
                          {uiText("Evaluation result")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {results.map((result) => (
                        <tr key={result.id}>
                          <td className="p-2">
                            <span className="break-words">
                              {result.objectiveTitle ??
                                selected.find(
                                  (item) => item.id === result.baselineRunId,
                                )?.objectiveTitle ??
                                result.scenarioKey}
                            </span>
                          </td>
                          <td className="p-2">
                            {result.baselineIssueId ? (
                              <Link
                                className="underline underline-offset-4"
                                to={`/issues/${result.baselineIssueId}`}
                              >
                                {uiText("Open task")}
                              </Link>
                            ) : (
                              <span className="font-mono">
                                {result.baselineRunId.slice(0, 8)}
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {result.candidateIssueId ? (
                              <Link
                                className="underline underline-offset-4"
                                to={`/issues/${result.candidateIssueId}`}
                              >
                                {uiText("Open task")}
                              </Link>
                            ) : (
                              <span className="font-mono">
                                {result.candidateRunId.slice(0, 8)}
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            <span className="font-medium">
                              {uiText(
                                result.passed
                                  ? "Passed"
                                  : result.findings.includes(
                                        "Candidate execution pending",
                                      )
                                    ? "Waiting for results"
                                    : "Needs attention",
                              )}
                            </span>
                            {!result.passed && (
                              <p className="text-xs text-muted-foreground">
                                {result.findings.join("; ")}
                              </p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <h4 className="text-sm font-medium">
                  {uiText("Publish readiness")}
                </h4>
                <ul className="flex flex-col gap-2 text-sm">
                  {[
                    [
                      revision?.status === "draft" && !dirty,
                      "Draft is saved and ready",
                    ],
                    [
                      distinctPassed >= 3,
                      "At least 3 distinct objectives passed",
                    ],
                    [allPassed, "No failed or pending evaluations"],
                  ].map(([passed, label]) => (
                    <li key={String(label)} className="flex items-center gap-2">
                      {passed ? (
                        <Check
                          aria-label={uiText("Passed")}
                          className="size-4 shrink-0"
                        />
                      ) : (
                        <Circle
                          aria-label={uiText("Needs attention")}
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span>{uiText(String(label))}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {uiText(
                    "Publication creates a new available revision. Unpinned defaults adopt it for future tasks; pinned versions and existing runs stay unchanged.",
                  )}
                </p>
                {publish.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {uiText(
                      "Could not publish this revision. Refresh results and check the readiness list.",
                    )}
                  </p>
                )}
                {publish.isSuccess && (
                  <p role="status" className="text-sm">
                    {uiText(
                      "Revision published. Existing runs keep their original rules.",
                    )}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    disabled={!ready || busy || evaluations.isFetching}
                    onClick={() => publish.mutate()}
                  >
                    {uiText(
                      publish.isPending ? "Publishing…" : "Publish revision",
                    )}
                  </Button>
                </div>
              </div>
              {revision?.status === "draft" && (
                <details className="border-t border-border pt-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {uiText("Advanced manual comparison")}
                  </summary>
                  <form
                    noValidate
                    className="flex flex-col gap-3 pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const result = workflowEvaluationSchema.safeParse(manual);
                      setManualInvalid(!result.success);
                      if (result.success) evaluate.mutate(result.data);
                    }}
                  >
                    <p className="text-xs text-muted-foreground">
                      {uiText(
                        "Compare matching frozen objectives only. Run IDs are available in each task's workflow details.",
                      )}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(
                        [
                          "baselineRunId",
                          "candidateRunId",
                          "scenarioKey",
                        ] as const
                      ).map((key) => (
                        <label
                          key={key}
                          className="flex min-w-0 flex-col gap-1 text-sm"
                        >
                          {uiText(
                            key === "baselineRunId"
                              ? "Baseline run ID"
                              : key === "candidateRunId"
                                ? "Candidate run ID"
                                : "Scenario label",
                          )}
                          <Input
                            value={manual[key]}
                            onChange={(event) =>
                              setManual({
                                ...manual,
                                [key]: event.target.value,
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    {(manualInvalid || evaluate.error) && (
                      <p role="alert" className="text-sm text-destructive">
                        {uiText(
                          "Could not evaluate this pair. Check the run IDs and their frozen objectives.",
                        )}
                      </p>
                    )}
                    {evaluate.isSuccess && (
                      <p role="status" className="text-sm">
                        {uiText("Comparison saved. Review the result above.")}
                      </p>
                    )}
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        disabled={busy || dirty}
                        type="submit"
                      >
                        {uiText(
                          evaluate.isPending
                            ? "Evaluating…"
                            : "Evaluate comparison",
                        )}
                      </Button>
                    </div>
                  </form>
                </details>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </section>
  );
}
