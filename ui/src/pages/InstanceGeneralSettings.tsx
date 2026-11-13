import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackupRetentionPolicy } from "@paperclipai/shared";
import { DAILY_RETENTION_PRESETS, WEEKLY_RETENTION_PRESETS, MONTHLY_RETENTION_PRESETS, DEFAULT_BACKUP_RETENTION } from "@paperclipai/shared";
import { healthApi } from "@/api/health";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { ModeBadge } from "@/components/access/ModeBadge";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { uiText, useUiLocale } from "@/i18n/ui";

const FEEDBACK_TERMS_URL = import.meta.env.VITE_FEEDBACK_TERMS_URL?.trim() || "https://paperclip.ing/tos";
const retentionFields = [
  { key: "dailyDays", label: "Daily", values: DAILY_RETENTION_PRESETS, unit: "{{count}} days", singular: "{{count}} day" },
  { key: "weeklyWeeks", label: "Weekly", values: WEEKLY_RETENTION_PRESETS, unit: "{{count}} weeks", singular: "{{count}} week" },
  { key: "monthlyMonths", label: "Monthly", values: MONTHLY_RETENTION_PRESETS, unit: "{{count}} months", singular: "{{count}} month" },
] as const;

type GeneralSection = "privacy" | "deployment" | "backups";
export function InstanceGeneralSettings({ section = "privacy" }: { section?: GeneralSection }) {
  const locale = useUiLocale();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const title = section === "backups" ? "Backup retention" : section === "deployment" ? "Deployment and auth" : "Privacy and data";
  useEffect(() => {
    setBreadcrumbs([{ label: uiText("Settings"), href: "/company/settings" },
      ...(section === "backups" ? [
        { label: uiText("Storage"), href: "/company/settings/instance/storage" },
        { label: uiText("Database backups"), href: "/company/settings/instance/storage/database-backups" },
      ] : [{ label: uiText("General"), href: "/company/settings" }]),
      { label: uiText(title) }]);
  }, [setBreadcrumbs, section, title, locale]);
  const general = useQuery({ queryKey: queryKeys.instance.generalSettings, queryFn: instanceSettingsApi.getGeneral });
  const health = useQuery({ queryKey: queryKeys.health, queryFn: healthApi.get, retry: false });
  const update = useMutation({ mutationFn: instanceSettingsApi.updateGeneral,
    onMutate: () => setSaved(false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
      setSaved(true);
    } });
  if (general.isPending || health.isPending) return <p role="status" className="text-sm text-muted-foreground">{uiText("Loading general settings...")}</p>;
  if (general.isError || health.isError) return <div role="alert" className="flex flex-col items-start gap-3">
    <p className="text-sm text-destructive">{uiText("Could not load settings. Retry before making changes.")}</p>
    <Button variant="outline" onClick={() => { void general.refetch(); void health.refetch(); }}>{uiText("Retry")}</Button>
  </div>;
  const hidden = new Set(health.data?.hiddenSettings ?? []);
  const policy: BackupRetentionPolicy = general.data?.backupRetention ?? DEFAULT_BACKUP_RETENTION;
  const sharing = general.data?.feedbackDataSharingPreference ?? "prompt";
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
    <header className="flex flex-col gap-2"><h1 className="text-xl font-semibold">{uiText(title)}</h1>
      <p className="text-sm text-muted-foreground">{uiText(section === "backups" ? "Choose how long automatic backups are kept. Changes save immediately."
        : section === "privacy" ? "Control log privacy and feedback sharing for this instance. Changes save immediately."
        : "Inspect how this instance is deployed and authenticated.")}</p></header>
    {update.isError && <p role="alert" className="text-sm text-destructive">{update.error.message}</p>}
    {(update.isPending || saved) && <p role="status" className="text-sm text-muted-foreground">{uiText(update.isPending ? "Saving..." : "Saved")}</p>}
    {section === "backups" && !hidden.has("instance.general.backupRetention") && <section className="flex flex-col gap-6">
      <div className="divide-y rounded-xl border border-border">{retentionFields.map(field => <div key={field.key} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div className="flex flex-col gap-1"><label htmlFor={`retention-${field.key}`} className="text-sm font-medium">{uiText(field.label)}</label>
          <p className="text-sm text-muted-foreground">{uiText(field.key === "dailyDays" ? "Keep every backup within this window." : field.key === "weeklyWeeks" ? "Then keep one backup per week." : "Then keep one backup per month.")}</p></div>
        <SelectField id={`retention-${field.key}`} className="w-40" value={policy[field.key]} disabled={update.isPending}
          onValueChange={value => update.mutate({ backupRetention: { ...policy, [field.key]: Number(value) } })}>
          {field.values.map(value => <option key={value} value={value}>{uiText(value === 1 ? field.singular : field.unit, { count: value })}</option>)}
        </SelectField>
      </div>)}</div>
      <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">{uiText("How backup retention works")}</summary>
        <p className="pt-3">{uiText("Backups run roughly every hour. Retention changes apply to future automatic pruning; this does not run a cleanup now.")}</p>
      </details>
    </section>}
    {section === "privacy" && <section className="divide-y rounded-xl border border-border">
      {!hidden.has("instance.general.censorUsernameInLogs") && <div className="flex items-center justify-between gap-4 px-4 py-4">
        <div className="flex flex-col gap-1"><h2 className="text-sm font-medium">{uiText("Censor username in logs")}</h2>
          <p className="text-sm text-muted-foreground">{uiText("Hide usernames in home-directory paths shown in logs.")}</p></div>
        <ToggleSwitch checked={general.data?.censorUsernameInLogs === true} disabled={update.isPending}
          aria-label={uiText("Toggle username log censoring")} onCheckedChange={() => update.mutate({ censorUsernameInLogs: !general.data?.censorUsernameInLogs })} />
      </div>}
      {!hidden.has("instance.general.feedbackDataSharingPreference") && <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-col gap-1"><h2 className="text-sm font-medium">{uiText("AI feedback sharing")}</h2>
          <p className="text-sm text-muted-foreground">{uiText("Choose whether voted AI outputs may be shared with Paperclip Labs.")}</p></div>
          <SelectField value={sharing} className="w-40" disabled={update.isPending} aria-label={uiText("AI feedback sharing")}
            onValueChange={value => update.mutate({ feedbackDataSharingPreference: value as "allowed" | "not_allowed" })}>
            {sharing === "prompt" && <option value="prompt" disabled>{uiText("Not chosen yet")}</option>}
            <option value="not_allowed">{uiText("Don't allow")}</option><option value="allowed">{uiText("Always allow")}</option>
          </SelectField>
        </div>
        <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">{uiText("What gets shared?")}</summary>
          <div className="flex flex-col gap-2 pt-3"><p>{uiText("Votes are always saved locally. Sharing allows the voted AI output to be sent to Paperclip Labs.")}</p>
            <a href={FEEDBACK_TERMS_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">{uiText("Read our terms of service")}</a></div>
        </details>
      </div>}
    </section>}
    {section === "deployment" && !hidden.has("instance.general.deploymentStatus") && <section className="flex flex-col gap-4">
      <ModeBadge deploymentMode={health.data?.deploymentMode} deploymentExposure={health.data?.deploymentExposure} />
      <p className="text-sm text-muted-foreground">{uiText(health.data?.deploymentMode === "local_trusted"
        ? "Local trusted mode is optimized for a local operator. Browser requests run as local board context and no sign-in is required."
        : health.data?.deploymentExposure === "public" ? "Authenticated public mode requires sign-in for board access and is intended for public URLs."
        : "Authenticated private mode requires sign-in and is intended for LAN, VPN, or other private-network deployments.")}</p>
      <dl className="divide-y rounded-xl border border-border">{[
        ["Auth readiness", health.data?.authReady ? "Ready" : "Not ready"],
        ["Bootstrap status", health.data?.bootstrapStatus === "bootstrap_pending" ? "Setup required" : "Ready"],
        ["Bootstrap invite", health.data?.bootstrapInviteActive ? "Active" : "None"],
      ].map(([label, value]) => <div key={label} className="flex justify-between gap-4 px-4 py-4"><dt className="text-sm text-muted-foreground">{uiText(label)}</dt><dd className="text-sm font-medium">{uiText(value)}</dd></div>)}</dl>
    </section>}
  </div>;
}
