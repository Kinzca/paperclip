import { useEffect } from "react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { SharedAgentInstructionsSettings } from "@/components/SharedAgentInstructionsSettings";
import { DecisionModelSettingsSection } from "@/components/decision-models/DecisionModelSettings";
import { FastResponseSettingsSection } from "@/components/fast-responses/FastResponseSettings";
import { SettingsNavigation, agentRulesLinks } from "@/components/SettingsNavigation";
import { useFastResponsesEnabled } from "@/hooks/useFastResponsesEnabled";
import { uiText, useUiLocale } from "@/i18n/ui";

export function AgentRulesSettings({ section }: { section?: "instructions" | "ai" }) {
  const locale = useUiLocale();
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const fastResponses = useFastResponsesEnabled();
  const title = section === "instructions" ? "Shared instructions" : section === "ai" ? "AI assistance" : "Agent rules";
  useEffect(() => {
    setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" },
      { label: uiText("Agent rules"), ...(section ? { href: "/company/settings/agent-rules" } : {}) },
      ...(section ? [{ label: uiText(title) }] : [])]);
  }, [setBreadcrumbs, section, title, locale]);
  if (!selectedCompany) return <p className="text-sm text-muted-foreground">{uiText("Select an organization to continue.")}</p>;
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
    <header className="flex flex-col gap-2"><h1 className="text-xl font-semibold">{uiText(title)}</h1>
      <p className="text-sm text-muted-foreground">{uiText(section === "instructions"
        ? "Set instructions once, then apply them to future agent runs."
        : section === "ai" ? "Manage optional AI decisions and short acknowledgements."
        : "Manage how agents receive instructions and use AI assistance.")}</p></header>
    {!section ? <SettingsNavigation items={agentRulesLinks} /> : section === "instructions"
      ? <SharedAgentInstructionsSettings key={selectedCompany.id} company={selectedCompany} showHeading={false} />
      : <div className="flex flex-col gap-8">
        <DecisionModelSettingsSection key={selectedCompany.id} companyId={selectedCompany.id} />
        {fastResponses.loaded && fastResponses.enabled && <FastResponseSettingsSection key={`fast-${selectedCompany.id}`} companyId={selectedCompany.id} />}
      </div>}
  </div>;
}
