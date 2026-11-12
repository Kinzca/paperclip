import { uiText, useUiLocale } from "@/i18n/ui";
import type { TaskBrowser } from "@paperclipai/shared";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TaskBrowserActivity({
  browser,
  label = "Browser",
  onOpen,
}: {
  browser: TaskBrowser;
  label?: string;
  onOpen?: (id: string) => void;
}) {
  useUiLocale();
  const closed = browser.status === "closed" || browser.status === "failed";
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 text-sm" aria-label={uiText("{{value0}} session", { value0: label })}>
      <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>{label}</span>
      <span className="text-muted-foreground">· {browser.status}</span>
      {onOpen && (
        <Button variant="ghost" size="sm" onClick={() => onOpen(browser.id)}>
          {closed ? uiText("View session") : uiText("Open browser")}
        </Button>
      )}
    </div>
  );
}
