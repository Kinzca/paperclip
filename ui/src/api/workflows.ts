import type {
  WorkflowEvaluation,
  WorkflowPolicy,
  WorkflowPolicyRecord,
  WorkflowRevision,
  WorkflowRunDetail,
  WorkflowTemplate,
} from "@paperclipai/shared";
import { api } from "./client";

export interface WorkflowConfiguration {
  platform: { version: number; policy: WorkflowPolicy };
  builtIn: WorkflowTemplate[];
  revisions: WorkflowRevision[];
  policies: WorkflowPolicyRecord[];
}
export const workflowsApi = {
  configuration: (companyId: string) =>
    api.get<WorkflowConfiguration>(`/companies/${companyId}/workflows`),
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
  evaluations: (companyId: string, revisionId: string) =>
    api.get<WorkflowEvaluation[]>(
      `/companies/${companyId}/workflows/revisions/${revisionId}/evaluations`,
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
    },
  ) => api.post(`/issues/${issueId}/workflow/decisions`, input),
};
