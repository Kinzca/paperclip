import type {
  WorkflowEvaluation,
  WorkflowReviewReport,
  WorkflowPolicy,
  WorkflowPolicyRecord,
  WorkflowRevision,
  WorkflowRunDetail,
  WorkflowTemplate,
  WorkflowBaselinePage,
} from "@paperclipai/shared";
import { api, detachInflightGet, type RequestOptions } from "./client";

// React Query deduplicates within an account. URL-only coalescing must not
// answer a new account's query with a request admitted under the old session.
function accountScopedGet<T>(path: string, options?: RequestOptions) {
  detachInflightGet(path);
  return api.get<T>(path, options);
}

export interface WorkflowConfiguration {
  platform: { version: number; policy: WorkflowPolicy };
  builtIn: WorkflowTemplate[];
  revisions: WorkflowRevision[];
  policies: WorkflowPolicyRecord[];
}
export const workflowsApi = {
  configuration: (companyId: string, options?: RequestOptions) =>
    accountScopedGet<WorkflowConfiguration>(
      `/companies/${companyId}/workflows`,
      options,
    ),
  baselines: (
    companyId: string,
    revisionId: string,
    q: string,
    offset = 0,
    options?: RequestOptions,
  ) =>
    accountScopedGet<WorkflowBaselinePage>(
      `/companies/${companyId}/workflows/revisions/${revisionId}/baselines?${new URLSearchParams({ q, offset: String(offset) })}`,
      options,
    ),
  policy: (
    companyId: string,
    input: {
      scope: "company" | "project";
      projectId: string | null;
      expectedVersion: number;
      policy: WorkflowPolicy;
    },
  ) => api.put(`/companies/${companyId}/workflows/policy`, input),
  propose: (
    companyId: string,
    input: {
      definition: WorkflowTemplate;
      basedOnRevisionId: string | null;
      rationale: string;
    },
  ) =>
    api.post<WorkflowRevision>(
      `/companies/${companyId}/workflows/revisions`,
      input,
    ),
  evaluations: (
    companyId: string,
    revisionId: string,
    options?: RequestOptions,
  ) =>
    accountScopedGet<WorkflowEvaluation[]>(
      `/companies/${companyId}/workflows/revisions/${revisionId}/evaluations`,
      options,
    ),
  evaluate: (
    companyId: string,
    revisionId: string,
    input: {
      baselineRunId: string;
      candidateRunId: string;
      scenarioKey: string;
    },
  ) =>
    api.post<WorkflowEvaluation>(
      `/companies/${companyId}/workflows/revisions/${revisionId}/evaluations`,
      input,
    ),
  publish: (companyId: string, revisionId: string) =>
    api.post<WorkflowRevision>(
      `/companies/${companyId}/workflows/revisions/${revisionId}/publish`,
      {},
    ),
  trials: (companyId: string, revisionId: string, baselineRunIds: string[]) =>
    api.post<{ issueId: string; runId: string }[]>(
      `/companies/${companyId}/workflows/revisions/${revisionId}/trials`,
      { baselineRunIds },
    ),
  run: (issueId: string) =>
    api.get<WorkflowRunDetail | null>(`/issues/${issueId}/workflow`),
  control: (
    issueId: string,
    input: {
      expectedVersion: number;
      action: "pause" | "resume" | "retry" | "cancel";
      reason: string;
    },
  ) => api.post(`/issues/${issueId}/workflow/control`, input),
  decide: (
    issueId: string,
    input: {
      expectedVersion: number;
      nodeId: string;
      attempt: number;
      outcome: "passed" | "failed";
      comment: string;
      report?: WorkflowReviewReport;
    },
  ) => api.post(`/issues/${issueId}/workflow/decisions`, input),
};
