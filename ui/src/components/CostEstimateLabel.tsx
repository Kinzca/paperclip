import { uiText, useUiLocale } from "@/i18n/ui";
import type { CostByAgent } from "@paperclipai/shared";
import { Badge } from "./ui/badge";

/** Use this group's ledger counts, never the page-wide estimate count. */
export function CostEstimateLabel({
  eventCount,
  estimatedEventCount,
}: Partial<Pick<CostByAgent, "eventCount" | "estimatedEventCount">>) {
  useUiLocale();
  if (!estimatedEventCount) return null;
  const allEstimated = estimatedEventCount === eventCount;
  return (
    <Badge
      variant="outline"
      className="font-normal text-muted-foreground"
      title={uiText("{{value0}} estimated {{value1}}. Calculated from token usage and published rates; provider bills may differ.", { value0: estimatedEventCount, value1: estimatedEventCount === 1 ? "charge" : "charges" })}
    >
      {allEstimated ? uiText("Estimated") : uiText("Partially estimated")}
    </Badge>
  );
}
