import type {
  StorageUsage, StorageCleanupInventory, StorageCleanupPreview, StorageCleanupResult,
  ProjectSpaceUsage,
  InstanceExperimentalSettingsWithManaged,
  InstanceGeneralSettings,
  InstanceSettings,
  PatchInstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
} from "@paperclipai/shared";
import { api } from "./client";

export const instanceSettingsApi = {
  getStorageCleanup: () => api.get<StorageCleanupInventory>("/instance/storage/cleanup"),
  previewStorageCleanup: (ids: string[]) => api.post<StorageCleanupPreview>("/instance/storage/cleanup-preview", { ids }),
  executeStorageCleanup: (token: string) => api.post<StorageCleanupResult>("/instance/storage/cleanup", { token, confirm: true }),
  getStorageUsage: (expanded = false) => api.get<StorageUsage>(`/instance/storage${expanded ? "?scan=expanded" : ""}`),
  getProjectSpaceUsage: (companyId: string, expanded = true) => api.get<ProjectSpaceUsage>(`/companies/${companyId}/project-space?scan=${expanded ? "expanded" : "standard"}`),
  get: () =>
    api.get<InstanceSettings>("/instance/settings"),
  update: (patch: PatchInstanceSettings) =>
    api.patch<InstanceSettings>("/instance/settings", patch),
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental", patch),
};
