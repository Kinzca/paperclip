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
import { uiText } from "@/i18n/ui";

const kinds = {
  task: { icon: SquareTerminal, label: "Execution" },
  check: { icon: ShieldCheck, label: "Evidence check" },
  review: { icon: CheckCheck, label: "Independent review" },
  approval: { icon: UserCheck, label: "Human acceptance" },
};

export function WorkflowDiagram({ choice }: { choice: WorkflowChoice }) {
  const stages = workflowStages(choice.definition);
  const names = new Map(
    choice.definition.nodes.map((node) => [
      node.id,
      workflowNodeTitle(choice, node),
    ]),
  );
  return (
    <ol
      aria-label={uiText("Current workflow")}
      className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-stretch"
    >
      {stages.map((nodes, index) => (
        <li
          key={nodes[0].id}
          className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row"
        >
          {index > 0 && (
            <>
              <ArrowDown
                aria-hidden="true"
                className="size-4 self-center text-muted-foreground lg:hidden"
              />
              <ArrowRight
                aria-hidden="true"
                className="hidden size-4 shrink-0 self-center text-muted-foreground lg:block"
              />
            </>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {nodes.length > 1 ? (
                <>
                  <GitBranch aria-hidden="true" className="size-3" />
                  {uiText("Runs in parallel")}
                </>
              ) : (
                uiText("Stage {{number}}", { number: index + 1 })
              )}
            </span>
            <div className="flex flex-1 flex-col justify-center gap-2">
              {nodes.map((node) => {
                const { icon: Icon, label } = kinds[node.kind];
                return (
                  <div
                    key={node.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                  >
                    <Icon
                      aria-hidden="true"
                      className="size-4 text-muted-foreground"
                    />
                    <span className="break-words text-sm font-medium">
                      {names.get(node.id)}
                    </span>
                    {names.get(node.id) !== uiText(label) && (
                      <span className="text-xs text-muted-foreground">
                        {uiText(label)}
                      </span>
                    )}
                    {node.dependsOn.length > 1 && (
                      <span className="break-words text-xs text-muted-foreground">
                        {uiText("Waits for: {{stages}}", {
                          stages: node.dependsOn
                            .map((id) => names.get(id))
                            .join(" · "),
                        })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
