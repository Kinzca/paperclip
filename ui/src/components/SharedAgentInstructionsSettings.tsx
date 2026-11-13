import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { accessApi } from "@/api/access";
import { companiesApi } from "@/api/companies";
import { useAccountIdentity } from "@/api/companies-query";
import { healthApi } from "@/api/health";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { uiText, useUiLocale } from "@/i18n/ui";
import { Button } from "./ui/button";
import { SharedAgentInstructionsEditor } from "./SharedAgentInstructionsEditor";

export function SharedAgentInstructionsSettings({ company, showHeading = true }: { company?: Company; showHeading?: boolean }) {
  useUiLocale();
  const client = useQueryClient();
  const identity = useAccountIdentity();
  const general = useQuery({ queryKey: queryKeys.instance.generalSettings, queryFn: instanceSettingsApi.getGeneral });
  const health = useQuery({ queryKey: queryKeys.health, queryFn: healthApi.get });
  const access = useQuery({ queryKey: [...queryKeys.access.currentBoardAccess, identity.userId], queryFn: accessApi.getCurrentBoardAccess, enabled: identity.settled, retry: false });
  if (general.isPending || health.isPending || (!identity.settled && !identity.failed) || identity.settled && access.isPending) {
    return <p role="status" className="text-sm text-muted-foreground">{uiText("Loading agent rules...")}</p>;
  }
  if (general.error || health.error || identity.failed) {
    return <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive">{uiText("Agent rules could not be loaded. Retry before editing.")}</p>
      <Button variant="outline" onClick={() => {
        void general.refetch(); void health.refetch();
        void client.invalidateQueries({ queryKey: queryKeys.auth.session });
      }}>{uiText("Retry")}</Button>
    </div>;
  }
  const account = identity.userId ?? "local-board";
  const canEditGlobal = access.data?.source === "local_implicit" || access.data?.isInstanceAdmin === true;
  const membership = access.data?.memberships?.find(item => item.companyId === company?.id && item.status === "active");
  const canEditCompany = !!access.data && (access.data.source === "local_implicit" || !!membership || access.data.companyIds.includes(company?.id ?? ""));
  const showGlobal = !health.data?.hiddenSettings?.includes("instance.general.agentInstructions");
  const globalRules = general.data?.agentInstructions ?? "";

  return <section className="max-w-2xl space-y-6" aria-label={uiText("Agent run rules")}>
    {showHeading && <div className="space-y-2">
      <h2 className="text-base font-semibold">{uiText("Agent run rules")}</h2>
      <p className="text-sm text-muted-foreground">{uiText("Global rules apply to every organization. Organization additions supplement them. Saved changes apply to the next run without interrupting current work.")}</p>
    </div>}
    {access.error ? <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive">{uiText("Editing permissions could not be checked. Saved rules remain available to read.")}</p>
      <Button variant="outline" onClick={() => void access.refetch()}>{uiText("Retry")}</Button>
    </div> : null}
    {showGlobal ? <SharedAgentInstructionsEditor
      key={`${account}:global`}
      draftKey={JSON.stringify([account, "agent-instructions", "global"])}
      title={uiText("Global agent instructions")}
      description={uiText("For all organizations and all agents, including new agents. Only instance administrators can edit this layer.")}
      value={globalRules}
      saveLabel={uiText("Save global rules")}
      readOnly={!canEditGlobal}
      onSave={async agentInstructions => {
        const saved = await instanceSettingsApi.updateGeneral({ agentInstructions });
        client.setQueryData(queryKeys.instance.generalSettings, saved);
        await client.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
      }}
    /> : null}
    {company ? <SharedAgentInstructionsEditor
      key={`${account}:${company.id}`}
      draftKey={JSON.stringify([account, "agent-instructions", company.id])}
      title={uiText("Organization additions — {{name}}", { name: company.name })}
      description={uiText("Only this organization receives these additions. Clearing them keeps global rules in place.")}
      value={company.agentInstructions ?? ""}
      saveLabel={uiText("Save organization additions")}
      readOnly={!canEditCompany}
      onSave={async agentInstructions => {
        await companiesApi.update(company.id, { agentInstructions });
        await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      }}
    /> : null}
    <details className="space-y-3 text-sm">
      <summary className="cursor-pointer font-medium">{company
        ? uiText("View saved shared rules for {{name}}", { name: company.name })
        : uiText("View saved global rules")}</summary>
      <p className="text-muted-foreground">{uiText("This preview contains saved shared rules only. Unsaved drafts and individual role instructions are not included. Rules do not change permissions, approvals, or budgets.")}</p>
      <div className="space-y-2">
        <h3 className="font-medium">{uiText("Global agent instructions")}</h3>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{globalRules.trim() || uiText("No saved rules.")}</pre>
      </div>
      {company ? <div className="space-y-2">
        <h3 className="font-medium">{uiText("Organization additions — {{name}}", { name: company.name })}</h3>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{company.agentInstructions?.trim() || uiText("No saved rules.")}</pre>
      </div> : null}
    </details>
  </section>;
}
