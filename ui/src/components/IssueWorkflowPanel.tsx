import {
  workflowReviewReportSchema,
  effectiveWorkflowLimits,
  workflowBudgetExtensionSchema,
  workflowLimitsSchema,
  type WorkflowControl,
} from "@paperclipai/shared";
import {
  workflowNodeTitle,
  workflowTemplateText,
} from "@/lib/workflow-presentation";
import "@/i18n/workflows";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { workflowsApi } from "../api/workflows";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { uiText, useUiLocale } from "@/i18n/ui";
import { ChevronRight } from "lucide-react";

export function IssueWorkflowPanel({ issueId }: { issueId: string }) {
  useUiLocale();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [extension, setExtension] = useState({
    additionalAttempts: "0",
    additionalMinutes: "0",
    additionalCostCents: "0",
  });
  const query = useQuery({
    queryKey: ["issue-workflow", issueId],
    queryFn: () => workflowsApi.run(issueId),
    refetchInterval: (query) =>
      query.state.data &&
      !["succeeded", "cancelled"].includes(query.state.data.status)
        ? 5000
        : false,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["issue-workflow", issueId] });
  const control = useMutation({
    mutationFn: (action: WorkflowControl["action"]) =>
      workflowsApi.control(issueId, {
        action,
        reason,
        expectedVersion: query.data!.version,
        ...(action === "extend"
          ? {
              extension: workflowBudgetExtensionSchema.parse(
                Object.fromEntries(
                  Object.entries(extension).map(([key, value]) => [
                    key,
                    Number(value),
                  ]),
                ),
              ),
            }
          : {}),
      }),
    onSuccess: refresh,
    onError: refresh,
  });
  const decision = useMutation({
    mutationFn: (input: {
      nodeId: string;
      attempt: number;
      outcome: "passed" | "failed";
    }) =>
      workflowsApi.decide(issueId, {
        ...input,
        expectedVersion: query.data!.version,
        comment: reason,
      }),
    onSuccess: refresh,
    onError: refresh,
  });
  if (query.isPending) return null;
  if (query.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  const run = query.data;
  if (!run) return null;
  const choice = {
    definition: run.snapshot.definition,
    builtIn: false,
    revision: run.snapshot.revision,
  };
  const stopped = ["paused", "waiting_human"].includes(run.status);
  const finished = ["succeeded", "cancelled"].includes(run.status);
  const limits = effectiveWorkflowLimits(run.snapshot, run.runtime);
  const grant = workflowBudgetExtensionSchema.safeParse(
    Object.fromEntries(
      Object.entries(extension).map(([key, value]) => [key, Number(value)]),
    ),
  );
  const validGrant =
    grant.success &&
    workflowLimitsSchema.safeParse({
      ...limits,
      maxAttempts: limits.maxAttempts + grant.data.additionalAttempts,
      timeoutMinutes: limits.timeoutMinutes === null ? null : limits.timeoutMinutes + grant.data.additionalMinutes,
      maxCostCents:
        limits.maxCostCents == null
          ? null
          : limits.maxCostCents + grant.data.additionalCostCents,
    }).success;
  return (
    <section
      className="rounded-lg border border-border p-3"
      aria-label={uiText("Task workflow")}
    >
      <details key={`${issueId}:${run.id}`} className="group/workflow">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 group-open/workflow:rotate-90"
          />
          <span>{uiText("Task workflow")}</span>
          <Badge variant="outline" className="ml-auto">
            {uiText(run.status)}
          </Badge>
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <p className="text-sm text-muted-foreground">
            {workflowTemplateText(choice, "name")} · {uiText("Revision")}{" "}
            {run.snapshot.revision} · {uiText("Attempt ceiling")}{" "}
            {limits.maxAttempts} · {uiText("Active execution minutes")}{" "}
            {limits.timeoutMinutes ?? uiText("No time limit")}
          </p>
          <p className="text-xs font-mono text-muted-foreground">{run.id}</p>
          {run.runtime?.humanWaitStartedAt && (
            <p role="status" className="text-sm text-muted-foreground">
              {uiText("Waiting for human acceptance — execution clock stopped.")}
            </p>
          )}
          {Object.entries(run.runtime?.repeatedFailures ?? {})
            .filter(([, failure]) => failure.consecutive >= 3)
            .map(([nodeId, failure]) => (
              <p key={nodeId} role="status" className="text-sm text-destructive">
                {uiText(
                  "Repeated failure detected at {{node}} ({{count}} times). Inspect the evidence before continuing.",
                  { node: nodeId, count: failure.consecutive },
                )}
              </p>
            ))}
          {run.stopReason && (
            <p
              role="status"
              className={finished ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
            >
              {run.stopReason}
            </p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              {uiText("Frozen task and execution context")}
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              <p className="font-medium">{run.snapshot.objective.title}</p>
              <p className="whitespace-pre-wrap">
                {run.snapshot.objective.description}
              </p>
              {run.snapshot.objective.plan && (
                <p className="whitespace-pre-wrap">{run.snapshot.objective.plan}</p>
              )}
              {run.snapshot.context?.map((layer, index) => (
                <div key={index}>
                  <p className="text-xs text-muted-foreground">
                    {uiText(layer.scope)}
                  </p>
                  <p className="whitespace-pre-wrap">{layer.instructions}</p>
                </div>
              ))}
              {run.snapshot.definition.handoffVersion === 1 && (
                <p className="text-xs text-muted-foreground">
                  {uiText(
                    "Handoff protocol v1: versioned deliverables, criterion evidence and actionable repair findings.",
                  )}
                </p>
              )}
            </div>
          </details>
          <ol className="flex flex-col gap-2">
            {run.snapshot.definition.nodes.map((node) => {
              const state = run.nodes[node.id];
              return (
                <li
                  key={node.id}
                  className="flex flex-col gap-1 rounded-md bg-muted p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {state.issueId ? (
                      <Link
                        className="text-sm font-medium underline"
                        to={`/issues/${state.issueId}`}
                      >
                        {workflowNodeTitle(choice, node)}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">
                        {workflowNodeTitle(choice, node)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {uiText(state.status)} · {state.attempt}/{limits.maxAttempts}
                    </span>
                  </div>
                  {node.dependsOn.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {uiText("Depends on")}: {node.dependsOn.join(", ")}
                    </p>
                  )}
                  {state.result && (
                    <p className="text-sm whitespace-pre-wrap">{state.result}</p>
                  )}
                  {node.kind !== "task" &&
                    node.kind !== "check" &&
                    state.userId &&
                    state.status === "running" &&
                    !finished && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!reason.trim() || decision.isPending}
                          onClick={() =>
                            decision.mutate({
                              nodeId: node.id,
                              attempt: state.attempt,
                              outcome: "passed",
                            })
                          }
                        >
                          {uiText("Accept result")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!reason.trim() || decision.isPending}
                          onClick={() =>
                            decision.mutate({
                              nodeId: node.id,
                              attempt: state.attempt,
                              outcome: "failed",
                            })
                          }
                        >
                          {uiText("Request changes")}
                        </Button>
                      </div>
                    )}
                </li>
              );
            })}
          </ol>
          {!finished && (
            <>
              <Textarea
                aria-label={uiText("Decision evidence or control reason")}
                placeholder={uiText("Decision evidence or control reason")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {run.isRoot && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!reason.trim() || control.isPending}
                    onClick={() => control.mutate("cancel")}
                  >
                    {uiText("Cancel workflow")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!reason.trim() || control.isPending}
                    onClick={() => control.mutate(stopped ? "resume" : "pause")}
                  >
                    {uiText(stopped ? "Resume workflow" : "Pause workflow")}
                  </Button>
                  {stopped && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!reason.trim() || control.isPending}
                      onClick={() => control.mutate("retry")}
                    >
                      {uiText("Retry failed stage")}
                    </Button>
                  )}
                </div>
              )}
              {run.isRoot && stopped && (
                <details className="rounded-md border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    {uiText("Add allowance and resume")}
                  </summary>
                  <div className="flex flex-col gap-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      {uiText(
                        "Add to this task only; original rules and evidence are retained. Total ceiling: 10 attempts per stage, 1440 minutes, 1000000 cents. Enter a reason above.",
                      )}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        {
                          key: "additionalAttempts" as const,
                          label: "Additional attempts per stage",
                          max: 10 - limits.maxAttempts,
                        },
                        ...(limits.timeoutMinutes === null ? [] : [{
                          key: "additionalMinutes" as const,
                          label: "Additional execution minutes",
                          max: 1440 - limits.timeoutMinutes,
                        }]),
                        ...(limits.maxCostCents == null
                          ? []
                          : [
                              {
                                key: "additionalCostCents" as const,
                                label: "Additional recorded cost (cents)",
                                max: 1000000 - limits.maxCostCents,
                              },
                            ]),
                      ].map((field) => (
                        <label key={field.key} className="flex flex-col gap-2">
                          {uiText(field.label)}
                          <Input
                            type="number"
                            min={0}
                            max={field.max}
                            step={1}
                            value={extension[field.key]}
                            disabled={control.isPending}
                            onChange={(event) =>
                              setExtension({
                                ...extension,
                                [field.key]: event.target.value,
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <Button
                      className="self-end"
                      size="sm"
                      disabled={!validGrant || !reason.trim() || control.isPending}
                      onClick={() => control.mutate("extend")}
                    >
                      {uiText("Add allowance and resume")}
                    </Button>
                  </div>
                </details>
              )}
            </>
          )}
          {(control.error || decision.error) && (
            <p role="alert" className="text-sm text-destructive">
              {(control.error ?? decision.error)!.message}
            </p>
          )}
          {!!run.runtime?.grants?.length && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                {uiText("Manual allowance history")} ({run.runtime.grants.length})
              </summary>
              <ul className="flex flex-col gap-3 pt-3">
                {run.runtime.grants.map((grant) => (
                  <li key={grant.id} className="rounded-md bg-muted p-3">
                    <p>
                      {uiText(
                        "Added: {{attempts}} attempts, {{minutes}} minutes, {{cost}} cents",
                        {
                          attempts: grant.additionalAttempts,
                          minutes: grant.additionalMinutes,
                          cost: grant.additionalCostCents,
                        },
                      )}
                    </p>
                    <p className="whitespace-pre-wrap">{grant.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {grant.userId} · {new Date(grant.grantedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {uiText("Retained attempt evidence")} ({run.attempts.length})
            </summary>
            <div className="flex flex-col gap-2 pt-2">
              {run.attempts.map((attempt) => (
                <div key={attempt.id}>
                  <p>
                    {attempt.nodeId} · {attempt.attempt} · {uiText(attempt.status)}
                  </p>
                  {attempt.issueId && (
                    <Link
                      className="text-xs underline"
                      to={`/issues/${attempt.issueId}`}
                    >
                      {uiText("Open task")}
                    </Link>
                  )}
                  <ReviewReport evidence={attempt.evidence} />
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      {uiText("Raw evidence")}
                    </summary>
                    <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs font-mono">
                      {JSON.stringify(attempt.evidence, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          </details>
        </div>
      </details>
    </section>
  );
}

function ReviewReport({
  evidence,
}: {
  evidence: Record<string, unknown> | null;
}) {
  const report = workflowReviewReportSchema.safeParse(evidence?.report);
  if (!report.success) return null;
  return (
    <div className="flex flex-col gap-3 py-3">
      <p className="text-xs text-muted-foreground">
        {uiText("Reviewer-reported evidence")}
      </p>
      <p className="break-words text-sm">
        {report.data.artifact} · {report.data.revision}
      </p>
      <ul className="flex flex-col gap-2">
        {report.data.criteria.map((item) => (
          <li key={item.id} className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">
              {item.id} · {item.requirement} · {uiText(item.outcome)}
            </p>
            <p className="whitespace-pre-wrap">{item.evidence}</p>
          </li>
        ))}
      </ul>
      {report.data.findings.map((item) => (
        <div key={item.id} className="text-sm">
          <p className="font-medium">
            {item.id} · {item.criterionId}
          </p>
          <p>{item.problem}</p>
          <p>
            {uiText("Requested change")}: {item.requestedChange}
          </p>
        </div>
      ))}
    </div>
  );
}
