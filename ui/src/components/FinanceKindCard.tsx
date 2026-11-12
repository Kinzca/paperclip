import { uiText, useUiLocale } from "@/i18n/ui";
import type { FinanceByKind } from "@paperclipai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { financeEventKindDisplayName, formatCents } from "@/lib/utils";

interface FinanceKindCardProps {
  rows: FinanceByKind[];
}

export function FinanceKindCard({ rows }: FinanceKindCardProps) {
  useUiLocale();
  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-1">
        <CardTitle className="text-base">{uiText("Financial event mix")}</CardTitle>
        <CardDescription>{uiText("Account-level charges grouped by event kind.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 pt-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{uiText("No finance events in this period.")}</p>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.eventKind}:${row.currency}`}
              className="flex items-center justify-between gap-3 border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{financeEventKindDisplayName(row.eventKind)}</div>
                <div className="text-xs text-muted-foreground">
                  {row.eventCount}{uiText(" event")}{row.eventCount === 1 ? "" : uiText("s")} · {row.billerCount}{uiText(" biller")}{row.billerCount === 1 ? "" : uiText("s")}
                </div>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-sm font-medium">{formatCents(row.netCents, row.currency)}</div>
                <div className="text-xs text-muted-foreground">
                  {formatCents(row.debitCents, row.currency)}{uiText(" debits")}</div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
