import { getUiLocale } from "@/i18n/ui";
import { uiText, useUiLocale } from "@/i18n/ui";
import { useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { NewAgentSetup } from "../components/new-agent/NewAgentSetup";

export function NewAgent() {
  useUiLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([
      { label: uiText("Agents"), href: "/agents" },
      { label: uiText("New agent") },
    ]);
  }, [setBreadcrumbs, getUiLocale()]);
  return <NewAgentSetup />;
}
