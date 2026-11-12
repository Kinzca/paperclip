import { uiText, useUiLocale } from "@/i18n/ui";
import { Blocks } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConnectionProvenanceChip({
  connection,
  className,
}: {
  connection: {
    config?: Record<string, unknown> | null;
    credentialSource?: string;
    externalCredential?: { connectorUid?: string } | null;
  } | null | undefined;
  className?: string;
}) {
  useUiLocale();
  const chipClass = cn(
    "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground",
    className,
  );
  if (connection?.credentialSource === "vercel_connect") {
    const connectorUid = connection.externalCredential?.connectorUid;
    return (
      <span
        className={chipClass}
        title={connectorUid ? uiText("Credentials managed by Vercel Connect ({{value0}})", { value0: connectorUid }) : uiText("Credentials managed by Vercel Connect")}
      >
        <Blocks className="h-3 w-3" />{uiText("via Vercel Connect")}</span>
    );
  }

  return null;
}
