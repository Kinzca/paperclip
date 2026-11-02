import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkflowRevisionSchema,
  resolveWorkflowPolicy,
  workflowPolicySchema,
  type WorkflowPolicy,
} from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { uiText, useUiLocale } from "@/i18n/ui";
import { Link } from "@/lib/router";

export function Workflows() {
  useUiLocale();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const client = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [enabled, setEnabled] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [limits, setLimits] = useState({
    maxAttempts: "",
    timeoutMinutes: "",
    maxParallelism: "",
    maxCostCents: "",
  });
  const [definition, setDefinition] = useState("");
  const [rationale, setRationale] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [baselineRunId, setBaselineRunId] = useState("");
  const [candidateRunId, setCandidateRunId] = useState("");
  const [scenarioKey, setScenarioKey] = useState("");
  const [baselineRuns, setBaselineRuns] = useState("");
  const config = useQuery({
    queryKey: ["workflows", selectedCompanyId],
    queryFn: () => workflowsApi.configuration(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const projects = useQuery({
    queryKey: ["workflow-projects", selectedCompanyId],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const policy = config.data?.policies.find((row) =>
    projectId ? row.projectId === projectId : row.scope === "company",
  );
  const evaluations = useQuery({
    queryKey: ["workflow-evaluations", selectedCompanyId, revisionId],
    queryFn: () => workflowsApi.evaluations(selectedCompanyId!, revisionId),
    enabled: !!selectedCompanyId && !!revisionId,
  });
  useEffect(() => {
    setBreadcrumbs([{ label: uiText("Task workflows") }]);
  }, [setBreadcrumbs]);
  useEffect(() => {
    setProjectId("");
    setRevisionId("");
  }, [selectedCompanyId]);
  useEffect(() => {
    setEnabled(
      policy?.policy.enabled === undefined ? "" : String(policy.policy.enabled),
    );
    setTemplateKey(policy?.policy.templateKey ?? "");
    setLimits({
      maxAttempts: String(policy?.policy.limits?.maxAttempts ?? ""),
      timeoutMinutes: String(policy?.policy.limits?.timeoutMinutes ?? ""),
      maxParallelism: String(policy?.policy.limits?.maxParallelism ?? ""),
      maxCostCents: String(policy?.policy.limits?.maxCostCents ?? ""),
    });
  }, [policy, projectId]);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["workflows", selectedCompanyId] });
  const save = useMutation({
    mutationFn: async () => {
      const overrides: WorkflowPolicy = workflowPolicySchema.parse({
        ...(enabled ? { enabled: enabled === "true" } : {}),
        ...(templateKey ? { templateKey } : {}),
        limits: Object.fromEntries(
          Object.entries(limits)
            .filter(([, value]) => value !== "")
            .map(([key, value]) => [key, Number(value)]),
        ),
      });
      return workflowsApi.policy(selectedCompanyId!, {
        scope: projectId ? "project" : "company",
        projectId: projectId || null,
        expectedVersion: policy?.version ?? 0,
        policy: overrides,
      });
    },
    onSuccess: refresh,
  });
  const propose = useMutation({
    mutationFn: async () => {
      const parsed = createWorkflowRevisionSchema.parse({
        definition: JSON.parse(definition),
        rationale,
      });
      const current = config
        .data!.revisions.filter(
          (row) =>
            row.templateKey === parsed.definition.key &&
            row.status === "published",
        )
        .sort((a, b) => b.revision - a.revision)[0];
      return workflowsApi.propose(selectedCompanyId!, {
        ...parsed,
        basedOnRevisionId: current?.id ?? null,
      });
    },
    onSuccess: async (revision) => {
      setRevisionId(revision.id);
      await refresh();
    },
  });
  const evaluate = useMutation({
    mutationFn: () =>
      workflowsApi.evaluate(selectedCompanyId!, revisionId, {
        baselineRunId,
        candidateRunId,
        scenarioKey,
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["workflow-evaluations", selectedCompanyId, revisionId],
      }),
  });
  const publish = useMutation({
    mutationFn: () => workflowsApi.publish(selectedCompanyId!, revisionId),
    onSuccess: refresh,
  });
  const trials = useMutation({
    mutationFn: () =>
      workflowsApi.trials(
        selectedCompanyId!,
        revisionId,
        baselineRuns.split(/[\s,]+/).filter(Boolean),
      ),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["workflow-evaluations", selectedCompanyId, revisionId],
      }),
  });
  if (!selectedCompanyId)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {uiText("Select a company to configure task workflows.")}
      </p>
    );
  if (config.isPending)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {uiText("Loading...")}
      </p>
    );
  if (config.error)
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {config.error.message}
      </p>
    );
  const data = config.data!;
  const effective = resolveWorkflowPolicy(
    data.policies
      .filter((row) => row.scope === "company" || row.projectId === projectId)
      .sort((a, b) => a.scope.localeCompare(b.scope))
      .map((row) => row.policy),
    data.platform.policy,
  );
  const published = data.revisions.filter((row) => row.status === "published");
  const templates = new Map(
    data.builtIn.map((template) => [template.key, template]),
  );
  for (const row of published.slice().reverse())
    templates.set(row.templateKey, row.definition);
  const error =
    save.error ??
    propose.error ??
    evaluate.error ??
    publish.error ??
    trials.error;
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{uiText("Task workflows")}</h1>
        <p className="text-sm text-muted-foreground">
          {uiText(
            "Configure once. New tasks inherit execution, verification, independent review and bounded repair. Running tasks keep their original rules.",
          )}
        </p>
      </div>
      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h2 className="text-base font-medium">
          {uiText("Inherited defaults")}
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          {uiText("Scope")}
          <select
            className="rounded-md border border-input bg-background p-2"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">{uiText("Company")}</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {projects.error && (
          <p role="alert" className="text-sm text-destructive">
            {projects.error.message}
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            {uiText("Workflow activation")}
            <select
              className="rounded-md border border-input bg-background p-2"
              value={enabled}
              onChange={(event) => setEnabled(event.target.value)}
            >
              <option value="">{uiText("Inherit")}</option>
              <option value="true">{uiText("Enabled")}</option>
              <option value="false">{uiText("Disabled")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {uiText("Template")}
            <select
              className="rounded-md border border-input bg-background p-2"
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value)}
            >
              <option value="">{uiText("Inherit")}</option>
              {[...templates.values()].map((template) => (
                <option key={template.key} value={template.key}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["maxAttempts", "Attempt ceiling"],
              ["timeoutMinutes", "Active time limit (minutes)"],
              ["maxParallelism", "Parallel stage ceiling"],
              ["maxCostCents", "Reported cost ceiling (cents)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              {uiText(label)}
              <Input
                type="number"
                min={1}
                value={limits[key]}
                placeholder={uiText("Inherit")}
                onChange={(event) =>
                  setLimits({ ...limits, [key]: event.target.value })
                }
              />
            </label>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {uiText("Effective saved defaults")}:{" "}
          {uiText(effective.enabled ? "Enabled" : "Disabled")} ·{" "}
          {effective.templateKey} · {effective.limits.maxAttempts}{" "}
          {uiText("attempts")} · {effective.limits.timeoutMinutes}{" "}
          {uiText("minutes")} · {uiText("Parallel stage ceiling")}{" "}
          {effective.limits.maxParallelism}
        </p>
        <p className="text-sm text-muted-foreground">
          {uiText(
            "Lower scopes can tighten inherited limits. A disabled ancestor cannot be enabled by a child scope. Cost ceilings use reported usage and complement native company budgets.",
          )}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {uiText("Applies to new tasks only")}
          </span>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {uiText("Save defaults")}
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">
          {uiText("Available templates")}
        </h2>
        {[...templates.values()].map((template) => (
          <article
            key={template.key}
            className="flex flex-col gap-2 rounded-lg border border-border p-4"
          >
            <h3 className="text-sm font-medium">{template.name}</h3>
            <p className="text-sm text-muted-foreground">
              {template.description}
            </p>
            <ol className="flex flex-wrap gap-2">
              {template.nodes.map((node) => (
                <li
                  key={node.id}
                  className="rounded-md bg-muted px-3 py-2 text-sm"
                >
                  {node.title}
                  {node.dependsOn.length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      ← {node.dependsOn.join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDefinition(JSON.stringify(template, null, 2))}
              >
                {uiText("Prepare improvement draft")}
              </Button>
            </div>
          </article>
        ))}
      </section>
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {uiText("Controlled workflow improvement")}
        </summary>
        <div className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-muted-foreground">
            {uiText(
              "Propose a revision, compare baseline and candidate runs on at least three distinct objectives, then publish. Acceptance checks stay fixed; existing runs remain pinned.",
            )}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            {uiText("Template definition")}
            <Textarea
              className="font-mono"
              rows={16}
              value={definition}
              onChange={(event) => setDefinition(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {uiText("Improvement rationale")}
            <Textarea
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
          <div className="flex justify-end">
            <Button
              disabled={!definition || !rationale.trim() || propose.isPending}
              onClick={() => propose.mutate()}
            >
              {uiText("Save draft revision")}
            </Button>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {uiText("Draft revision")}
            <select
              className="rounded-md border border-input bg-background p-2"
              value={revisionId}
              onChange={(event) => setRevisionId(event.target.value)}
            >
              <option value="">{uiText("Select a draft")}</option>
              {data.revisions
                .filter((row) => row.status === "draft")
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.templateKey} · {row.revision}
                  </option>
                ))}
            </select>
          </label>
          {revisionId && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                {uiText("Baseline regression runs (at least three)")}
                <Textarea
                  value={baselineRuns}
                  onChange={(event) => setBaselineRuns(event.target.value)}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                {uiText(
                  "Start candidate tasks from these frozen objectives. Execution and evaluation continue automatically; publication requires your approval.",
                )}
              </p>
              <div className="flex justify-end">
                <Button
                  disabled={!baselineRuns.trim() || trials.isPending}
                  onClick={() => trials.mutate()}
                >
                  {uiText("Run candidate regressions")}
                </Button>
              </div>
              {trials.data?.map((trial) => (
                <Link
                  key={trial.runId}
                  className="text-sm underline"
                  to={`/issues/${trial.issueId}`}
                >
                  {trial.runId}
                </Link>
              ))}
              <p className="text-sm text-muted-foreground">
                {uiText(
                  "Use task workflow run IDs. Baseline and candidate must share the same frozen objective; renamed scenario labels do not count as additional coverage.",
                )}
              </p>
              <Input
                aria-label={uiText("Baseline run ID")}
                placeholder={uiText("Baseline run ID")}
                value={baselineRunId}
                onChange={(event) => setBaselineRunId(event.target.value)}
              />
              <Input
                aria-label={uiText("Candidate run ID")}
                placeholder={uiText("Candidate run ID")}
                value={candidateRunId}
                onChange={(event) => setCandidateRunId(event.target.value)}
              />
              <Input
                aria-label={uiText("Scenario label")}
                placeholder={uiText("Scenario label")}
                value={scenarioKey}
                onChange={(event) => setScenarioKey(event.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  disabled={
                    !baselineRunId ||
                    !candidateRunId ||
                    !scenarioKey ||
                    evaluate.isPending
                  }
                  onClick={() => evaluate.mutate()}
                >
                  {uiText("Evaluate regression")}
                </Button>
              </div>
              {evaluations.error && (
                <p role="alert" className="text-sm text-destructive">
                  {evaluations.error.message}
                </p>
              )}
              {evaluations.data?.map((trial) => (
                <div key={trial.id} className="text-sm">
                  <span className="font-mono">
                    {trial.scenarioKey.slice(0, 12)}
                  </span>{" "}
                  · {uiText(trial.passed ? "passed" : "failed")}{" "}
                  {trial.findings.join("; ")}
                </div>
              ))}
              <div className="flex justify-end">
                <Button
                  disabled={
                    publish.isPending ||
                    !evaluations.data ||
                    evaluations.data.length < 3 ||
                    evaluations.data.some((trial) => !trial.passed)
                  }
                  onClick={() => publish.mutate()}
                >
                  {uiText("Publish verified revision")}
                </Button>
              </div>
            </>
          )}
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          {uiText("Defaults saved. New tasks will inherit them.")}
        </p>
      )}
    </div>
  );
}
