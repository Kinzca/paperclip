import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { workflowsApi } from "../api/workflows";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { uiText, useUiLocale } from "@/i18n/ui";

export function IssueWorkflowPanel({ issueId }: { issueId: string }) {
  useUiLocale();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
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
    mutationFn: (action: "pause" | "resume" | "retry" | "cancel") =>
      workflowsApi.control(issueId, {
        action,
        reason,
        expectedVersion: query.data!.version,
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
  const stopped = ["paused", "waiting_human"].includes(run.status);
  const finished = ["succeeded", "cancelled"].includes(run.status);
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      aria-label={uiText("Task workflow")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{uiText("Task workflow")}</h3>
        <Badge variant="outline">{uiText(run.status)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {run.snapshot.definition.name} · {uiText("Revision")}{" "}
        {run.snapshot.revision} · {uiText("Attempt ceiling")}{" "}
        {run.snapshot.limits.maxAttempts}
      </p>
      <p className="text-xs font-mono text-muted-foreground">{run.id}</p>
      {run.stopReason && (
        <p role="status" className="text-sm text-destructive">
          {run.stopReason}
        </p>
      )}
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
                    {node.title}
                  </Link>
                ) : (
                  <span className="text-sm font-medium">{node.title}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {uiText(state.status)} · {state.attempt}/
                  {run.snapshot.limits.maxAttempts}
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
        </>
      )}
      {(control.error || decision.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(control.error ?? decision.error)!.message}
        </p>
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
              <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs font-mono">
                {JSON.stringify(attempt.evidence, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
