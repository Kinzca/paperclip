import { uiText, useUiLocale } from "@/i18n/ui";
import { useQuery } from "@tanstack/react-query";
import type { DecisionHistoryEntry } from "@paperclipai/shared";
import { decisionModelsApi } from "@/api/decision-models";
import { Link } from "@/lib/router";
import { formatDateTime, formatTokens, formatDetailedCents } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFastResponsesEnabled } from "@/hooks/useFastResponsesEnabled";

export function DecisionHistoryTable({ entries, fastResponse = false, connectionsEnabled = true }: { entries: (DecisionHistoryEntry & { publicationStatus?: string; connectionName?: string | null })[]; fastResponse?: boolean; connectionsEnabled?: boolean }) {
  useUiLocale();
  if (!entries.length) return <p className="text-sm text-muted-foreground">{fastResponse ? uiText("No fast responses in this period.") : uiText("No decision requests in this period.")} <Link to={connectionsEnabled ? "/company/settings/connections" : fastResponse ? "/company/settings/instance/experimental" : "/company/settings"} className="underline underline-offset-4">{fastResponse ? connectionsEnabled ? uiText("Configure fast response") : uiText("Enable experimental fast responses") : uiText("Configure a decision model")}</Link>{uiText(" to run a test.")}</p>;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{uiText("Recent requests. Inputs are not retained.")}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm" aria-label={fastResponse ? uiText("Fast responses") : uiText("Decision requests")}>
      <thead><tr className="border-b border-border text-muted-foreground">{["When / feature", "Responsible", "Task", ...(fastResponse ? ["Connection"] : []), "Model", "Status", "Duration", "Tokens in / out", "Cost"].map(label => <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{entries.map(row => <tr key={row.id} className="border-b border-border last:border-0">
        <td className="px-3 py-3"><div className="whitespace-nowrap">{formatDateTime(row.startedAt)}</div><div className="text-xs text-muted-foreground">{row.feature === "settings.test" ? uiText("Setup test") : row.feature}</div></td>
        <td className="px-3 py-3">{row.actorType === "system" ? uiText("Paperclip services") : row.userName ?? (row.responsibleUserId === "local-board" ? uiText("Board") : uiText("Former user"))}</td>
        <td className="px-3 py-3">{row.issueId ? <Link className="underline underline-offset-4" to={`/issues/${row.issueIdentifier ?? row.issueId}`}>{row.issueIdentifier ?? uiText("View task")}</Link> : "—"}</td>
        {fastResponse && <td className="px-3 py-3">{row.connectionName ?? (row.connectionId ? uiText("Removed connection") : "—")}</td>}
        <td className="px-3 py-3 font-mono text-xs">{row.model}</td>
        <td className="px-3 py-3"><div>{row.status === "succeeded" ? uiText("Succeeded") : row.status === "running" ? uiText("Running") : row.status === "unknown" ? uiText("Unresolved") : row.status === "skipped" ? uiText("Skipped") : row.status === "pending" ? uiText("Pending") : uiText("Failed")}</div>{row.publicationStatus && <div className="text-xs text-muted-foreground">{row.publicationStatus}</div>}{row.errorCode && <div className="text-xs text-muted-foreground">{row.errorCode.replaceAll("_", " ")}</div>}</td>
        <td className="px-3 py-3 font-mono">{row.durationMs === null ? "—" : uiText("{{value0}}s", { value0: (row.durationMs / 1000).toFixed(1) })}</td>
        <td className="whitespace-nowrap px-3 py-3 font-mono">{row.inputTokens === null ? "—" : formatTokens(row.inputTokens)} / {row.outputTokens === null ? "—" : formatTokens(row.outputTokens)}</td>
        <td className="px-3 py-3 font-mono"><div>{row.costCents === null ? uiText("Unknown") : formatDetailedCents(row.costCents)}</div>{row.costStatus !== "unpriced" && row.costStatus && <span className="text-xs text-muted-foreground">{row.costStatus === "estimated" ? uiText("Estimated") : uiText("Reported")}</span>}</td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}
export function DecisionHistory({ companyId, from, to }: { companyId: string; from?: string | null; to?: string | null }) {
  useUiLocale();
  const { enabled } = useFastResponsesEnabled();
  const query = useQuery({ queryKey: ["decision-history", companyId, from, to], queryFn: () => decisionModelsApi.history(companyId, from, to), refetchInterval: q => q.state.data?.some(row => row.status === "running") ? 5000 : false });
  if (query.isPending) return <p className="text-sm text-muted-foreground">{uiText("Loading decision requests…")}</p>;
  if (query.error) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{uiText("Could not load decision requests.")}</p><Button variant="outline" onClick={() => void query.refetch()}>{uiText("Try again")}</Button></div>;
  return <DecisionHistoryTable entries={query.data ?? []} connectionsEnabled={enabled} />;
}
