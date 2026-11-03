import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GitBranch, Pencil, RotateCcw } from "lucide-react";
import {
  resolveWorkflowPolicy,
  type WorkflowPolicy,
} from "@paperclipai/shared";
import { workflowsApi } from "@/api/workflows";
import { projectsApi } from "@/api/projects";
import { ApiError, detachInflightGet } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkflowDiagram } from "@/components/WorkflowDiagram";
import {
  WorkflowImprovements,
  type DraftRequest,
} from "@/components/WorkflowImprovements";
import {
  parseWorkflowDraft,
  savedWorkflowChoice,
  workflowChoices,
  workflowDraftFromPolicy,
  workflowLimitFields,
  workflowTemplateText,
  type WorkflowChoice,
} from "@/lib/workflow-presentation";
import { formatCents } from "@/lib/utils";
import { uiText, useUiLocale } from "@/i18n/ui";
import "@/i18n/workflows";

export function Workflows() {
  const { selectedCompanyId } = useCompany();
  const account = useAccountIdentity();
  const queryClient = useQueryClient();
  useUiLocale();
  if (account.failed)
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p>
          {uiText(
            "Could not verify your account. Retry to load workflow settings.",
          )}
        </p>
        <Button
          variant="outline"
          onClick={() =>
            void queryClient.invalidateQueries({
              queryKey: queryKeys.auth.session,
            })
          }
        >
          {uiText("Retry")}
        </Button>
      </div>
    );
  if (!account.settled)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {uiText("Loading...")}
      </p>
    );
  return selectedCompanyId ? (
    <CompanyWorkflows
      key={`${account.userId}:${selectedCompanyId}`}
      companyId={selectedCompanyId}
      accountId={account.userId}
    />
  ) : (
    <p className="p-6 text-sm text-muted-foreground">
      {uiText("Select a company to configure task workflows.")}
    </p>
  );
}

function CompanyWorkflows({
  companyId,
  accountId,
}: {
  companyId: string;
  accountId: string | null;
}) {
  const locale = useUiLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  const client = useQueryClient();
  const cacheKey = [
    "workflow-editor-session",
    accountId,
    companyId,
    "defaults",
  ];
  const cached = client.getQueryData<{
    projectId: string;
    draft: ReturnType<typeof workflowDraftFromPolicy>;
    originalDraft: ReturnType<typeof workflowDraftFromPolicy>;
    editorVersion: number;
  }>(cacheKey);
  const [projectId, setProjectId] = useState(cached?.projectId ?? "");
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [editing, setEditing] = useState(!!cached);
  const [draft, setDraft] = useState(
    () => cached?.draft ?? workflowDraftFromPolicy(),
  );
  const [originalDraft, setOriginalDraft] = useState(
    cached?.originalDraft ?? draft,
  );
  const [editorVersion, setEditorVersion] = useState(
    cached?.editorVersion ?? 0,
  );
  const [restored] = useState(!!cached);
  const [showValidation, setShowValidation] = useState(false);
  const [draftRequest, setDraftRequest] = useState<DraftRequest | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const config = useQuery({
    queryKey: ["workflows", companyId, accountId],
    queryFn: ({ signal }) => workflowsApi.configuration(companyId, { signal }),
  });
  const projects = useQuery({
    queryKey: ["workflow-projects", companyId, accountId],
    queryFn: ({ signal }) => {
      detachInflightGet(`/companies/${encodeURIComponent(companyId)}/projects`);
      return projectsApi.list(companyId, {}, { signal });
    },
  });
  const policy = config.data?.policies.find((row) =>
    projectId ? row.projectId === projectId : row.scope === "company",
  );
  const dirty =
    editing && JSON.stringify(draft) !== JSON.stringify(originalDraft);
  const parsed = parseWorkflowDraft(draft);
  useEffect(() => {
    client.setQueryDefaults(["workflow-editor-session"], { gcTime: Infinity });
    if (dirty)
      client.setQueryData(cacheKey, {
        projectId,
        draft,
        originalDraft,
        editorVersion,
      });
    else client.removeQueries({ queryKey: cacheKey, exact: true });
  }, [
    client,
    accountId,
    companyId,
    projectId,
    dirty,
    draft,
    originalDraft,
    editorVersion,
  ]);

  useEffect(() => {
    setBreadcrumbs([{ label: uiText("Task workflows") }]);
  }, [setBreadcrumbs, locale]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (editing) editorHeading.current?.focus();
  }, [editing]);

  const save = useMutation({
    mutationFn: (overrides: WorkflowPolicy) =>
      workflowsApi.policy(companyId, {
        scope: projectId ? "project" : "company",
        projectId: projectId || null,
        expectedVersion: editorVersion,
        policy: overrides,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workflows", companyId] });
      setEditing(false);
    },
  });
  function editRules(templateKey?: string) {
    const next = workflowDraftFromPolicy(policy?.policy);
    if (templateKey) {
      next.templateKey = templateKey;
      next.revision = undefined;
    }
    setOriginalDraft(workflowDraftFromPolicy(policy?.policy));
    setDraft(next);
    setEditorVersion(policy?.version ?? 0);
    setShowValidation(false);
    save.reset();
    setEditing(true);
  }
  function changeScope(value: string) {
    setProjectId(value);
    setEditing(false);
    setPendingScope(null);
    save.reset();
  }
  function prepare(choice: WorkflowChoice) {
    setDraftRequest({ choice, request: (draftRequest?.request ?? 0) + 1 });
  }

  if (config.isPending)
    return (
      <div role="status" className="flex flex-col gap-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <span className="text-sm text-muted-foreground">
          {uiText("Loading...")}
        </span>
      </div>
    );
  if (config.error)
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p>{uiText("Could not load workflow settings.")}</p>
        <Button variant="outline" onClick={() => void config.refetch()}>
          {uiText("Retry")}
        </Button>
      </div>
    );

  const data = config.data;
  const choices = workflowChoices(data);
  const scopeLabel = uiText(
    projectId ? "Project defaults" : "Company defaults",
  );
  const companyPolicy = data.policies.find((row) => row.scope === "company");
  const layers = [
    { name: uiText("Platform defaults"), policy: data.platform.policy },
    ...(companyPolicy
      ? [{ name: uiText("Company defaults"), policy: companyPolicy.policy }]
      : []),
    ...(projectId && policy
      ? [{ name: uiText("Project defaults"), policy: policy.policy }]
      : []),
  ];
  const saved = resolveWorkflowPolicy(
    layers.slice(1).map((layer) => layer.policy),
    data.platform.policy,
  );
  const parentPolicies =
    projectId && companyPolicy ? [companyPolicy.policy] : [];
  const inherited = resolveWorkflowPolicy(parentPolicies, data.platform.policy);
  const preview =
    editing && parsed.policy
      ? resolveWorkflowPolicy(
          [...parentPolicies, parsed.policy],
          data.platform.policy,
        )
      : saved;
  const savedChoice = savedWorkflowChoice(data, saved);
  const previewChoice = savedWorkflowChoice(data, preview);
  const activeChoice = dirty && parsed.policy ? previewChoice : savedChoice;
  const name = (choice: WorkflowChoice | undefined) =>
    choice
      ? workflowTemplateText(choice, "name")
      : uiText("Workflow unavailable");
  function limitValue(
    key: (typeof workflowLimitFields)[number]["key"],
    value: number | null,
  ) {
    if (key === "maxCostCents")
      return value == null ? uiText("No additional limit") : formatCents(value);
    return uiText(
      key === "maxAttempts"
        ? "{{count}} attempts"
        : key === "timeoutMinutes"
          ? "{{count}} minutes"
          : "{{count}} stages",
      { count: value },
    );
  }
  const changedElsewhere = editing && editorVersion !== (policy?.version ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold">{uiText("Task workflows")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {uiText(
              "Rules for future tasks. Existing runs keep their original rules.",
            )}
          </p>
        </div>
        <div className="min-w-0 sm:w-64 sm:shrink-0">
          <Select
            value={projectId || "company"}
            disabled={save.isPending}
            onValueChange={(value) => {
              const nextProjectId = value === "company" ? "" : value;
              if (nextProjectId === projectId) return;
              if (dirty) setPendingScope(nextProjectId);
              else changeScope(nextProjectId);
            }}
          >
            <SelectTrigger className="w-full text-sm" aria-label={uiText("Scope")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value="company">{uiText("Company defaults")}</SelectItem>
              {projects.data?.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      {projects.error && (
        <p role="alert" className="text-sm text-destructive">
          {projects.error.message}
        </p>
      )}
      {pendingScope !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4"
        >
          <p className="text-sm">
            {uiText("You have unsaved changes. Discard them to change scope?")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setPendingScope(null)}>
              {uiText("Keep editing")}
            </Button>
            <Button variant="outline" onClick={() => changeScope(pendingScope)}>
              {uiText("Discard and switch")}
            </Button>
          </div>
        </div>
      )}

      <section
        aria-labelledby="workflow-overview"
        className="flex flex-col gap-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="workflow-overview"
                className="break-words text-lg font-semibold"
              >
                {name(activeChoice)}
              </h2>
              <Badge variant="secondary">
                {uiText(preview.enabled ? "Enabled" : "Disabled")}
              </Badge>
              {dirty && (
                <Badge variant="outline">{uiText("Unsaved preview")}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {activeChoice
                ? workflowTemplateText(activeChoice, "description")
                : uiText(
                    "Choose an available template in Edit rules, then save again.",
                  )}
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{scopeLabel}</span>
              <span>
                {activeChoice?.revision
                  ? uiText("Version {{version}}", {
                      version: activeChoice.revision,
                    })
                  : uiText("Built-in template")}
              </span>
              {policy && (
                <span>
                  {uiText("Policy version {{version}}", {
                    version: policy.version,
                  })}
                </span>
              )}
            </div>
          </div>
          {!editing && (
            <Button variant="outline" onClick={() => editRules()}>
              <Pencil aria-hidden="true" />
              {uiText("Edit rules")}
            </Button>
          )}
        </div>
        {activeChoice && <WorkflowDiagram choice={activeChoice} />}
        <dl className="grid gap-4 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-4">
          {workflowLimitFields.map((field) => {
            const source =
              layers.find(
                (layer) =>
                  layer.policy.limits?.[field.key] != null &&
                  layer.policy.limits[field.key] === saved.limits[field.key],
              )?.name ?? uiText("Platform defaults");
            return (
              <div key={field.key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">
                  {uiText(
                    field.key === "maxCostCents"
                      ? "Reported cost limit"
                      : field.label,
                  )}
                </dt>
                <dd className="font-mono text-sm font-medium">
                  {limitValue(field.key, preview.limits[field.key])}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {dirty
                    ? uiText("Unsaved preview")
                    : field.key === "maxCostCents" &&
                        saved.limits.maxCostCents == null
                      ? uiText("Company budgets still apply")
                      : uiText("Limited by {{source}}", { source })}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="text-xs text-muted-foreground">
          {uiText(
            "Standard root tasks inherit these rules when first assigned. Conversations, routine tasks and existing assigned tasks are excluded.",
          )}
        </p>
        {save.isSuccess && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Check aria-hidden="true" className="size-4" />
            {uiText("Rules saved. Future eligible tasks will inherit them.")}
          </p>
        )}
      </section>

      {editing && (
        <form
          noValidate
          className="flex flex-col gap-5 rounded-lg border border-border p-4 md:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            setShowValidation(true);
            if (parsed.policy && !changedElsewhere) save.mutate(parsed.policy);
          }}
        >
          {restored && (
            <p role="status" className="text-sm text-muted-foreground">
              {uiText(
                "Your unsaved changes for this company have been restored.",
              )}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <h2
              ref={editorHeading}
              tabIndex={-1}
              className="text-base font-semibold outline-none"
            >
              {uiText("Change defaults")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {uiText(
                "Leave a limit empty to inherit. A project can tighten its parent's limits, but cannot lift them.",
              )}
            </p>
          </div>
          <fieldset
            disabled={save.isPending}
            className="grid min-w-0 gap-4 sm:grid-cols-2"
          >
            <legend className="sr-only">{uiText("Change defaults")}</legend>
            <div className="flex min-w-0 flex-col gap-1.5 text-sm">
              <span>{uiText("Template")}</span>
              <Select
                disabled={save.isPending}
                value={draft.templateKey ? `template:${draft.templateKey}` : "inherit"}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    templateKey: value === "inherit" ? "" : value.slice("template:".length),
                    revision: undefined,
                  })
                }
              >
                <SelectTrigger className="w-full text-sm" aria-label={uiText("Template")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="inherit">
                    {uiText("Inherit")} ·{" "}
                    {name(savedWorkflowChoice(data, inherited))}
                  </SelectItem>
                  {choices.map((choice) => (
                    <SelectItem
                      key={choice.definition.key}
                      value={`template:${choice.definition.key}`}
                    >
                      {name(choice)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 text-sm">
              <span>{uiText("Workflow activation")}</span>
              <Select
                disabled={save.isPending}
                value={draft.enabled || "inherit"}
                onValueChange={(value) =>
                  setDraft({ ...draft, enabled: value === "inherit" ? "" : value })
                }
              >
                <SelectTrigger className="w-full text-sm" aria-label={uiText("Workflow activation")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="inherit">
                    {uiText("Inherit")} ·{" "}
                    {uiText(inherited.enabled ? "Enabled" : "Disabled")}
                  </SelectItem>
                  <SelectItem value="true" disabled={!inherited.enabled}>
                    {uiText("Enabled")}
                  </SelectItem>
                  <SelectItem value="false">{uiText("Disabled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </fieldset>
          <fieldset
            disabled={save.isPending}
            className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <legend className="pb-3 text-sm font-medium">
              {uiText("Execution limits")}
            </legend>
            {workflowLimitFields.map((field) => (
              <div key={field.key} className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={`workflow-${field.key}`} className="text-sm">
                  {uiText(field.label)}
                </label>
                <Input
                  id={`workflow-${field.key}`}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  inputMode={
                    field.key === "maxCostCents" ? "decimal" : "numeric"
                  }
                  value={draft[field.key]}
                  placeholder={
                    field.key === "maxCostCents"
                      ? inherited.limits.maxCostCents == null
                        ? uiText("No additional limit")
                        : String(inherited.limits.maxCostCents / 100)
                      : String(inherited.limits[field.key])
                  }
                  aria-invalid={showValidation && !!parsed.errors[field.key]}
                  aria-describedby={`workflow-${field.key}-help`}
                  onChange={(event) =>
                    setDraft({ ...draft, [field.key]: event.target.value })
                  }
                />
                <p
                  id={`workflow-${field.key}-help`}
                  className={
                    showValidation && parsed.errors[field.key]
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {showValidation && parsed.errors[field.key]
                    ? parsed.errors[field.key]
                    : uiText("Inherit") +
                      " · " +
                      limitValue(field.key, inherited.limits[field.key])}
                </p>
              </div>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {uiText(
              "Reported costs may arrive after execution. This is an additional stop condition, not a prepaid budget.",
            )}
          </p>
          {dirty && parsed.policy && (
            <div className="grid gap-3 rounded-md bg-muted p-3 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">
                  {uiText("Before saving")} ·{" "}
                </span>
                {name(savedChoice)} ·{" "}
                {uiText(saved.enabled ? "Enabled" : "Disabled")}
              </p>
              <p>
                <span className="text-muted-foreground">
                  {uiText("After saving")} ·{" "}
                </span>
                {name(previewChoice)} ·{" "}
                {uiText(preview.enabled ? "Enabled" : "Disabled")}
              </p>
            </div>
          )}
          {(changedElsewhere || save.error) && (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 text-sm text-destructive"
            >
              <p>
                {changedElsewhere ||
                (save.error instanceof ApiError && save.error.status === 409)
                  ? uiText(
                      "Rules changed elsewhere. Your edits are preserved. Reload saved rules before trying again.",
                    )
                  : uiText(
                      "Could not save rules. Your edits are preserved. Try again.",
                    )}
              </p>
              {(changedElsewhere ||
                (save.error instanceof ApiError &&
                  save.error.status === 409)) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void config.refetch().then((result) => {
                      if (!result.isSuccess) return;
                      const latest = result.data.policies.find((row) =>
                        projectId
                          ? row.projectId === projectId
                          : row.scope === "company",
                      );
                      setEditorVersion(latest?.version ?? 0);
                      save.reset();
                    })
                  }
                >
                  <RotateCcw aria-hidden="true" />
                  {uiText("Reload saved rules")}
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setEditing(false);
                save.reset();
              }}
            >
              {uiText("Discard changes")}
            </Button>
            <Button
              type="submit"
              disabled={!dirty || save.isPending || changedElsewhere}
            >
              {uiText(save.isPending ? "Saving rules…" : "Save rules")}
            </Button>
          </div>
        </form>
      )}

      <section
        aria-labelledby="available-workflows"
        className="flex flex-col gap-3"
      >
        <h2 id="available-workflows" className="text-base font-semibold">
          {uiText("Available workflows")}
        </h2>
        <div className="divide-y divide-border">
          {choices.map((choice) => (
            <article
              key={choice.definition.key}
              className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <GitBranch
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                  <h3 className="break-words text-sm font-medium">
                    {name(choice)}
                  </h3>
                  {savedChoice?.definition.key === choice.definition.key &&
                    savedChoice.revision === choice.revision && (
                      <Badge variant="outline">
                        {uiText("Current selection")}
                      </Badge>
                    )}
                </div>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  {workflowTemplateText(choice, "description")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={editing}
                  onClick={() => editRules(choice.definition.key)}
                >
                  {uiText("Use this workflow")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => prepare(choice)}
                >
                  {uiText("Improve this workflow")}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <WorkflowImprovements
        companyId={companyId}
        accountId={accountId}
        config={data}
        request={draftRequest}
        onCreate={() => activeChoice && prepare(activeChoice)}
      />
    </div>
  );
}
