import { useQuery } from "@tanstack/react-query";
import {
  AGENT_ROLES,
  type WorkflowBinding,
  type WorkflowPolicy,
  type WorkflowTemplate,
} from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { uiText } from "@/i18n/ui";
import { SelectField } from "./ui/select-field";

const valueOf = (binding?: WorkflowBinding) =>
  !binding
    ? ""
    : binding.kind === "role"
      ? `role:${binding.role}`
      : binding.kind === "agent"
        ? `agent:${binding.agentId}`
        : binding.kind;
export function WorkflowBindingsEditor({
  companyId,
  accountId,
  definition,
  bindings,
  inherited,
  disabled,
  onChange,
}: {
  companyId: string;
  accountId: string | null;
  definition: WorkflowTemplate;
  bindings: NonNullable<WorkflowPolicy["bindings"]>;
  inherited: NonNullable<WorkflowPolicy["bindings"]>;
  disabled: boolean;
  onChange: (bindings: NonNullable<WorkflowPolicy["bindings"]>) => void;
}) {
  const roster = useQuery({
    queryKey: ["workflow-binding-agents", companyId, accountId],
    queryFn: () => agentsApi.list(companyId),
  });
  function bindingLabel(binding: WorkflowBinding) {
    if (binding.kind === "executor") return uiText("Task assignee");
    if (binding.kind === "human") return uiText("Responsible human");
    if (binding.kind === "role")
      return uiText("Role: {{role}}", { role: uiText(binding.role) });
    return (
      roster.data?.find((agent) => agent.id === binding.agentId)?.name ??
      uiText(
        roster.isPending ? "Loading agent name…" : "Agent name unavailable",
      )
    );
  }
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <legend className="pb-2 text-sm font-medium">
        {uiText("Stage responsibilities")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {uiText(
          "Roles resolve within this company. Reviewers must be independent; missing reviewers require human intervention.",
        )}
      </p>
      {roster.error && (
        <p role="alert" className="text-sm text-destructive">
          {roster.error.message}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {definition.nodes
          .filter((node) => node.kind !== "check")
          .map((node) => {
            const selected = bindings[node.id];
            return (
              <label key={node.id} className="flex flex-col gap-1.5 text-sm">
                {uiText(node.title)}
                <SelectField
                  disabled={disabled}
                  value={valueOf(selected)}
                  onValueChange={(value) => {
                    const next = { ...bindings };
                    if (!value) delete next[node.id];
                    else
                      next[node.id] = value.startsWith("role:")
                        ? {
                            kind: "role",
                            role: value.slice(
                              5,
                            ) as (typeof AGENT_ROLES)[number],
                          }
                        : value.startsWith("agent:")
                          ? { kind: "agent", agentId: value.slice(6) }
                          : { kind: value as "executor" | "human" };
                    onChange(next);
                  }}
                >
                  <option value="">
                    {uiText("Inherit: {{responsibility}}", {
                      responsibility: bindingLabel(
                        inherited[node.id] ?? node.binding,
                      ),
                    })}
                  </option>
                  <option value="human">{uiText("Responsible human")}</option>
                  {node.kind !== "approval" && (
                    <>
                      {node.kind === "task" && (
                        <option value="executor">
                          {uiText("Task assignee")}
                        </option>
                      )}
                      {AGENT_ROLES.map((role) => (
                        <option key={role} value={`role:${role}`}>
                          {uiText("Role")} · {uiText(role)}
                        </option>
                      ))}
                      {selected?.kind === "agent" &&
                        !roster.data?.some(
                          (agent) => agent.id === selected.agentId,
                        ) && (
                          <option value={`agent:${selected.agentId}`}>
                            {bindingLabel(selected)}
                          </option>
                        )}
                      {roster.data
                        ?.filter((agent) => agent.status !== "terminated")
                        .map((agent) => (
                          <option key={agent.id} value={`agent:${agent.id}`}>
                            {agent.name}
                          </option>
                        ))}
                    </>
                  )}
                </SelectField>
              </label>
            );
          })}
      </div>
    </fieldset>
  );
}
