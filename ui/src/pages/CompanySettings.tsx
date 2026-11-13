import { uiText, useUiLocale, getUiLocale } from "@/i18n/ui";
import { ChangeEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type InteractionResolverGovernance,
  type IssueThreadInteractionKind,
} from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useOptionalToastActions } from "../context/ToastContext";
import { useCloudInstance } from "../hooks/useCloudInstance";
import { resolveCompanyArchiveDeparture } from "../lib/company-selection";
import { cloudPortfolioManageUrl } from "../lib/cloudLinks";
import { navigateTopLevel } from "@/lib/browserNavigation";
import { companiesApi } from "../api/companies";
import { assetsApi } from "../api/assets";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import {
  InteractionGovernancePanel,
  applyGovernanceChange,
  type GovernanceField,
  type GovernanceSelectValue,
} from "../components/InteractionGovernancePanel";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import {
  Field,
  ToggleField,
} from "../components/agent-config-primitives";
import { SettingsNavigation, generalSettingsLinks } from "@/components/SettingsNavigation";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import { useAccountIdentity } from "../api/companies-query";

export function CompanySettings({ section = "general" }: { section?: "general" | "policies" | "organization" }) {
  useUiLocale();
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toastActions = useOptionalToastActions();
  const cloud = useCloudInstance();
  // Managed instances derive the task ID prefix from the company name, so a
  // rename here also renumbers the existing task IDs.
  const isCloudManaged = Boolean(cloud);
  // General settings local state
  const { userId } = useAccountIdentity();
  const nameDraft = useSettingsDraft(JSON.stringify([userId ?? "local-board", selectedCompanyId, "name"]), selectedCompany?.name ?? "");
  const descriptionDraft = useSettingsDraft(JSON.stringify([userId ?? "local-board", selectedCompanyId, "description"]), selectedCompany?.description ?? "");
  const companyName = nameDraft.text;
  const description = descriptionDraft.text;
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<InteractionResolverGovernance>({});

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setLogoUrl(selectedCompany.logoUrl ?? "");
    setGovernance(selectedCompany.interactionResolverGovernance ?? {});
  }, [selectedCompany]);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      companyId: string;
      nameDraft: ReturnType<typeof useSettingsDraft>;
      descriptionDraft: ReturnType<typeof useSettingsDraft>;
    }) => companiesApi.update(data.companyId, { name: data.nameDraft.text.trim(), description: data.descriptionDraft.text.trim() || null }),
    onSuccess: (company, submitted) => {
      submitted.nameDraft.saved(submitted.nameDraft.text, company.name);
      submitted.descriptionDraft.saved(submitted.descriptionDraft.text, company.description ?? "");
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const governanceMutation = useMutation({
    mutationFn: (next: InteractionResolverGovernance) =>
      companiesApi.update(selectedCompanyId!, { interactionResolverGovernance: next }),
    onSuccess: (company) => {
      setGovernance(company.interactionResolverGovernance ?? {});
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  function handleGovernanceChange(
    kind: IssueThreadInteractionKind,
    field: GovernanceField,
    value: GovernanceSelectValue,
  ) {
    const next = applyGovernanceChange(governance, kind, field, value);
    setGovernance(next);
    governanceMutation.mutate(next);
  }

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  const archiveMutation = useMutation({
    mutationFn: ({ companyId }: { companyId: string }) =>
      companiesApi.archive(companyId),
    onSuccess: async (_result, { companyId }) => {
      // Never stay on the archived company's settings: the only visible
      // change would be the archive button going inert. Leave for wherever
      // still makes sense (another active company, the Cloud portfolio, or
      // the companies list), with a toast naming what happened.
      const archived = companies.find((company) => company.id === companyId);
      const archivedName = archived?.name ?? "Organization";
      const departure = resolveCompanyArchiveDeparture({
        archivedCompanyId: companyId,
        companies,
        cloudPortfolioUrl: cloudPortfolioManageUrl(cloud?.cloudBaseUrl),
      });
      if (departure.kind === "cloud_portfolio") {
        // The whole organization is on its way to being archived by the
        // control plane; a full navigation to the Cloud portfolio replaces
        // this document, so cache invalidation below would never run.
        navigateTopLevel(departure.url);
        return;
      }
      if (departure.kind === "company") {
        toastActions?.pushToast({
          title: `${archivedName} is archived`,
          body: `Switched to ${departure.company.name}.`,
          tone: "info",
          dedupeKey: `company-archive-departure:${companyId}`,
        });
        setSelectedCompanyId(departure.company.id);
        navigate(`/${departure.company.issuePrefix}/dashboard`, { replace: true });
      } else {
        toastActions?.pushToast({
          title: `${archivedName} is archived`,
          body: "You can unarchive it from this list.",
          tone: "info",
          dedupeKey: `company-archive-departure:${companyId}`,
        });
        navigate(`/${archived?.issuePrefix ?? ""}/companies`, { replace: true });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  const title = section === "policies" ? "Hiring and interaction policies" : section === "organization" ? "Organization management" : "General";
  useEffect(() => {
    setBreadcrumbs([
      { label: uiText("Settings"), href: "/company/settings" },
      ...(section === "policies" ? [{ label: uiText("Members and permissions"), href: "/company/settings/members" }]
        : section === "organization" ? [{ label: uiText("General"), href: "/company/settings" }] : []),
      { label: uiText(title) },
    ]);
  }, [setBreadcrumbs, section, title, getUiLocale()]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">{uiText("No organization selected. Select an organization from the switcher above.")}</div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      companyId: selectedCompanyId!,
      nameDraft,
      descriptionDraft,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{uiText(title)}</h1>
      </div>

      {section === "general" && <SettingsNavigation items={generalSettingsLinks}>
      <div className="flex flex-col gap-6">
      {/* General */}
      <div className="max-w-2xl space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{uiText("Organization information")}</div>
        <div className="space-y-3">
          <Field label={uiText("Organization name")} hint={uiText("The display name for your organization.")}>
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => nameDraft.change(e.target.value)}
            />
            {isCloudManaged && (
              <p className="mt-1 text-xs text-muted-foreground">{uiText("Renaming can change this company's task ID prefix. Existing task IDs are renumbered and old task links stop resolving.")}</p>
            )}
          </Field>
          <Field
            label={uiText("Description")}
            hint={uiText("Optional description shown in the organization profile.")}
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder={uiText("Optional organization description")}
              onChange={(e) => descriptionDraft.change(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="max-w-2xl space-y-4">
        <div className="space-y-3">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                logoUrl={logoUrl || null}
                className="rounded-(--rad-14)"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label={uiText("Logo")}
                hint={uiText("Upload a PNG, JPEG, WEBP, GIF, or SVG logo image.")}
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? uiText("Removing...") : uiText("Remove logo")}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.isError || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ??
                        (logoUploadMutation.error instanceof Error
                          ? logoUploadMutation.error.message
                          : uiText("Logo upload failed"))}
                    </span>
                  )}
                  {clearLogoMutation.isError && (
                    <span className="text-xs text-destructive">
                      {clearLogoMutation.error.message}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">{uiText("Uploading logo...")}</span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {(generalDirty || generalMutation.isSuccess || generalMutation.isError) && <div className="flex flex-col gap-2">
        {generalDirty && <div className="flex items-center justify-between gap-3">
          <Button size="sm" variant="ghost" disabled={generalMutation.isPending} onClick={() => {
            nameDraft.change(selectedCompany.name); descriptionDraft.change(selectedCompany.description ?? ""); generalMutation.reset();
          }}>{uiText("Cancel")}</Button>
          <Button size="sm" onClick={handleSaveGeneral} disabled={generalMutation.isPending || !companyName.trim()}>
            {uiText(generalMutation.isPending ? "Saving..." : "Save changes")}
          </Button>
        </div>}
        {generalMutation.isSuccess && !generalDirty && <p role="status" className="text-sm text-muted-foreground">{uiText("Saved")}</p>}
        {generalMutation.isError && <p role="alert" className="text-sm text-destructive">{generalMutation.error instanceof Error ? generalMutation.error.message : uiText("Failed to save")}</p>}
      </div>}

      </div>
      </SettingsNavigation>}

      {section === "policies" && <>

      {/* Hiring */}
      <div className="max-w-2xl space-y-4" data-testid="company-settings-team-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{uiText("Hiring")}</div>
        <div>
          <ToggleField
            label={uiText("Require board approval for new hires")}
            hint={uiText("New agent hires stay pending until approved by board.")}
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
            toggleTestId="company-settings-team-approval-toggle"
          />
        </div>
      </div>

      {/* Interaction governance */}
      <InteractionGovernancePanel
        governance={governance}
        onChange={handleGovernanceChange}
        isPending={governanceMutation.isPending}
        errorMessage={
          governanceMutation.isError
            ? governanceMutation.error instanceof Error
              ? governanceMutation.error.message
              : "Failed to save interaction governance"
            : null
        }
      />

      </>}

      {section === "organization" && <>
      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">{uiText("Danger Zone")}</div>
        <div className="space-y-3 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">{uiText("Archive this organization to hide it from the sidebar. This persists in the database.")}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive organization "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                archiveMutation.mutate({ companyId: selectedCompanyId });
              }}
            >
              {archiveMutation.isPending
                ? uiText("Archiving...")
                : selectedCompany.status === "archived"
                ? uiText("Already archived")
                : uiText("Archive organization")}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : uiText("Failed to archive organization")}
              </span>
            )}
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
