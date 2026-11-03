import { useId, useState } from "react";
import { Languages } from "lucide-react";
import { uiText, useUiLocale, setUiLocale, type UiLocale } from "@/i18n/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function LanguageSelect() {
  const locale = useUiLocale();
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        <Languages className="size-4 text-muted-foreground" />{uiText("Language")}
      </label>
      <Select value={locale} disabled={saving} onValueChange={async value => {
        setSaving(true);
        try { setSaveFailed(!await setUiLocale(value as UiLocale)); } finally { setSaving(false); }
      }}>
        <SelectTrigger id={id} size="sm" className="w-32 text-sm" aria-label={uiText("Language")}><SelectValue /></SelectTrigger>
        <SelectContent position="popper" align="end"><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
      </Select>
    </div>
    {saveFailed ? <p role="status" className="text-xs text-muted-foreground">{uiText("Language changed for this session. Browser storage is unavailable, so the preference could not be saved.")}</p> : null}
  </div>;
}
