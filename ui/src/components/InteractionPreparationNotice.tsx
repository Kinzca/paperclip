import { uiText, useUiLocale } from "@/i18n/ui";
import { Loader2 } from "lucide-react";

export function InteractionPreparationNotice() {
  useUiLocale();
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden className="h-4 w-4 animate-spin" />{uiText("Preparing approval…")}</div>
  );
}
