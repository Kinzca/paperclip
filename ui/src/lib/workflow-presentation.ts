import {
  BUILT_IN_WORKFLOW_TEMPLATES,
  workflowPolicySchema,
  type WorkflowPolicy,
  type WorkflowTemplate,
} from "@paperclipai/shared";
import type { WorkflowConfiguration } from "@/api/workflows";
import { uiText } from "@/i18n/ui";
import "@/i18n/workflows";

export type WorkflowChoice = {
  definition: WorkflowTemplate;
  builtIn: boolean;
  revision: number | null;
};
export type WorkflowDraft = {
  context?: string;
  bindings?: WorkflowPolicy["bindings"];
  enabled: string;
  templateKey: string;
  revision?: number;
  maxAttempts: string;
  timeoutMinutes: string;
  maxParallelism: string;
  maxCostCents: string;
};
/** Translate canonical system labels; preserve names and copy authored by users. */
export function workflowTemplateText(
  choice: WorkflowChoice,
  field: "name" | "description",
) {
  const text = choice.definition[field];
  const canonical = BUILT_IN_WORKFLOW_TEMPLATES.find(
    (item) => item.key === choice.definition.key,
  );
  return choice.builtIn || canonical?.[field] === text ? uiText(text) : text;
}
export function workflowNodeTitle(
  choice: WorkflowChoice,
  node: WorkflowTemplate["nodes"][number],
) {
  const canonical = BUILT_IN_WORKFLOW_TEMPLATES.find(
    (item) => item.key === choice.definition.key,
  )?.nodes.find((item) => item.id === node.id);
  return choice.builtIn || canonical?.title === node.title
    ? uiText(node.title)
    : node.title;
}
export const workflowLimitFields = [
  { key: "maxAttempts", label: "Per-stage attempts", min: 1, max: 10, step: 1 },
  {
    key: "timeoutMinutes",
    label: "Active execution time",
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: "maxParallelism",
    label: "Concurrent stages",
    min: 1,
    max: 10,
    step: 1,
  },
  {
    key: "maxCostCents",
    label: "Cost limit (USD)",
    min: 0.01,
    max: 10000,
    step: 0.01,
  },
] as const;

export function workflowChoices(
  config: WorkflowConfiguration,
): WorkflowChoice[] {
  const choices = new Map(
    config.builtIn.map((definition) => [
      definition.key,
      { definition, builtIn: true, revision: null } as WorkflowChoice,
    ]),
  );
  for (const row of config.revisions
    .filter((row) => row.status === "published")
    .sort((a, b) => a.revision - b.revision)) {
    choices.set(row.templateKey, {
      definition: row.definition,
      builtIn: false,
      revision: row.revision,
    });
  }
  return [...choices.values()];
}

export function savedWorkflowChoice(
  config: WorkflowConfiguration,
  policy: { templateKey: string; revision?: number },
): WorkflowChoice | undefined {
  if (policy.revision === undefined)
    return workflowChoices(config).find(
      (item) => item.definition.key === policy.templateKey,
    );
  const revision = config.revisions.find(
    (row) =>
      row.status === "published" &&
      row.templateKey === policy.templateKey &&
      row.revision === policy.revision,
  );
  if (revision)
    return {
      definition: revision.definition,
      builtIn: false,
      revision: revision.revision,
    };
  const builtin = config.builtIn.find(
    (item) => item.key === policy.templateKey,
  );
  return builtin && policy.revision === 1
    ? { definition: builtin, builtIn: true, revision: null }
    : undefined;
}

export function workflowDraftFromPolicy(
  policy: WorkflowPolicy = {},
): WorkflowDraft {
  return {
    context: policy.context ?? "",
    bindings: policy.bindings ?? {},
    enabled: policy.enabled === undefined ? "" : String(policy.enabled),
    templateKey: policy.templateKey ?? "",
    revision: policy.revision,
    maxAttempts: String(policy.limits?.maxAttempts ?? ""),
    timeoutMinutes: String(policy.limits?.timeoutMinutes ?? ""),
    maxParallelism: String(policy.limits?.maxParallelism ?? ""),
    maxCostCents:
      policy.limits?.maxCostCents == null
        ? ""
        : (policy.limits.maxCostCents / 100).toFixed(2),
  };
}

/** Parse user-editable strings once; callers pass the resulting policy to the API. */
export function parseWorkflowDraft(draft: WorkflowDraft) {
  const errors: Partial<Record<keyof WorkflowDraft, string>> = {};
  for (const field of workflowLimitFields) {
    const raw = draft[field.key].trim();
    if (!raw) continue;
    const number = Number(raw);
    const cost = field.key === "maxCostCents";
    if (
      !Number.isFinite(number) ||
      number < field.min ||
      number > field.max ||
      (cost ? !/^\d+(?:\.\d{1,2})?$/.test(raw) : !Number.isInteger(number))
    ) {
      errors[field.key] = cost
        ? uiText(
            "Use an amount from $0.01 to $10,000.00, with at most two decimal places.",
          )
        : uiText("Use whole numbers from {{min}} to {{max}}.", field);
    }
  }
  if (Object.keys(errors).length) return { policy: null, errors };
  const result = workflowPolicySchema.safeParse({
    ...(draft.context?.trim() ? { context: draft.context.trim() } : {}),
    ...(draft.bindings && Object.keys(draft.bindings).length
      ? { bindings: draft.bindings }
      : {}),
    ...(draft.enabled ? { enabled: draft.enabled === "true" } : {}),
    ...(draft.templateKey ? { templateKey: draft.templateKey } : {}),
    ...(draft.revision === undefined ? {} : { revision: draft.revision }),
    limits: Object.fromEntries(
      workflowLimitFields
        .filter(({ key }) => draft[key].trim())
        .map(({ key }) => [
          key,
          key === "maxCostCents"
            ? Math.round(Number(draft[key]) * 100)
            : Number(draft[key]),
        ]),
    ),
  });
  if (!result.success) {
    for (const issue of result.error.issues)
      errors[
        issue.path[0] === "limits"
          ? (issue.path[1] as keyof WorkflowDraft)
          : (issue.path[0] as keyof WorkflowDraft)
      ] = uiText(
        "Invalid workflow definition at {{path}}. Check the field and try again.",
        { path: issue.path.join(".") },
      );
    return { policy: null, errors };
  }
  return { policy: result.data, errors };
}

/** Templates have already passed the shared DAG schema at their boundary. */
export function workflowStages(template: WorkflowTemplate) {
  const byId = new Map(template.nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();
  function depth(id: string): number {
    const existing = depths.get(id);
    if (existing !== undefined) return existing;
    const value = Math.max(-1, ...byId.get(id)!.dependsOn.map(depth)) + 1;
    depths.set(id, value);
    return value;
  }
  const stages: WorkflowTemplate["nodes"][] = [];
  for (const node of template.nodes) (stages[depth(node.id)] ??= []).push(node);
  return stages;
}

export function workflowCategory(choice: WorkflowChoice) {
  return (
    choice.definition.category ??
    BUILT_IN_WORKFLOW_TEMPLATES.find(
      (item) => item.key === choice.definition.key,
    )?.category ??
    "general"
  );
}
