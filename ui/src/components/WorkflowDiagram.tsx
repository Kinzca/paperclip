import {
  ArrowDown,
  ArrowRight,
  CheckCheck,
  GitBranch,
  ShieldCheck,
  SquareTerminal,
  UserCheck,
} from "lucide-react";
import type { WorkflowChoice } from "@/lib/workflow-presentation";
import { workflowNodeTitle, workflowStages } from "@/lib/workflow-presentation";
import { cn } from "@/lib/utils";
import { uiText } from "@/i18n/ui";

const kinds = {
  task: { icon: SquareTerminal, label: "Execution" },
  check: { icon: ShieldCheck, label: "Evidence check" },
  review: { icon: CheckCheck, label: "Independent review" },
  approval: { icon: UserCheck, label: "Human acceptance" },
};

// 根据内容区域宽度切换整条流程，避免侧栏展开时挤压阶段列或中途折行。
const layouts = {
  2: {
    columns: "@2xl:grid-cols-2",
    horizontal: "@2xl:block",
    vertical: "@2xl:hidden",
  },
  3: {
    columns: "@4xl:grid-cols-3",
    horizontal: "@4xl:block",
    vertical: "@4xl:hidden",
  },
  4: {
    columns: "@5xl:grid-cols-4",
    horizontal: "@5xl:block",
    vertical: "@5xl:hidden",
  },
};

export function WorkflowDiagram({ choice }: { choice: WorkflowChoice }) {
  const stages = workflowStages(choice.definition);
  const layout = layouts[stages.length as keyof typeof layouts];
  const names = new Map(
    choice.definition.nodes.map((node) => [
      node.id,
      workflowNodeTitle(choice, node),
    ]),
  );
  return (
    <div className="@container min-w-0">
      <ol
        aria-label={uiText("Current workflow")}
        className={cn("grid grid-cols-1 items-start gap-4", layout?.columns)}
      >
        {stages.map((nodes, index) => (
          <li key={nodes[0].id} className="flex min-w-0 flex-col gap-3">
            <div className="flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <span>{uiText("Stage {{number}}", { number: index + 1 })}</span>
                {nodes.length > 1 && (
                  <span className="inline-flex items-center gap-1">
                    <GitBranch aria-hidden="true" className="size-3" />
                    {uiText("Runs in parallel")}
                  </span>
                )}
              </div>
              {index < stages.length - 1 && layout && (
                <ArrowRight
                  aria-hidden="true"
                  className={cn("hidden size-4 shrink-0", layout.horizontal)}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {nodes.map((node) => {
                const { icon: Icon, label } = kinds[node.kind];
                return (
                  <div
                    key={node.id}
                    className="flex min-h-36 min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-4"
                  >
                    <div className="flex items-start gap-2">
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <h3 className="min-w-0 break-words text-sm font-medium">
                        {names.get(node.id)}
                      </h3>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {names.get(node.id) !== uiText(label) && (
                        <p>{uiText(label)}</p>
                      )}
                      <p className="break-words">
                        {node.kind === "check"
                          ? uiText("System check")
                          : uiText(
                              node.binding.kind === "executor"
                                ? "Task assignee"
                                : node.binding.kind === "human"
                                  ? "Responsible human"
                                  : node.binding.kind === "role"
                                    ? "Role"
                                    : "Agent",
                            )}
                        {node.kind !== "check" && node.binding.kind === "role"
                          ? ` · ${uiText(node.binding.role)}`
                          : ""}
                      </p>
                    </div>
                    {(node.onFailure || node.dependsOn.length > 1) && (
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {node.onFailure && (
                          <p className="break-words">
                            {uiText("On failure: return to {{stage}}", {
                              stage:
                                names.get(node.onFailure) ?? node.onFailure,
                            })}
                          </p>
                        )}
                        {node.dependsOn.length > 1 && (
                          <p className="break-words">
                            {uiText("Waits for: {{stages}}", {
                              stages: node.dependsOn
                                .map((id) => names.get(id))
                                .join(" · "),
                            })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {index < stages.length - 1 && (
              <ArrowDown
                aria-hidden="true"
                className={cn(
                  "size-4 self-center text-muted-foreground",
                  layout?.vertical,
                )}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
