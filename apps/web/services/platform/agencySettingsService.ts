import type {
  AgencyBrandingProfile,
  AgencyOperationalSettings,
  AgencyOrganisationSettings,
  BrandingAsset,
  CommunicationPolicy,
  MaintenancePolicySettings,
  PublicAgencyBranding,
  SettingsOverview,
} from '../../types/platform';
import { apiRequest } from '../apiClient';

export async function getOrganisationSettings(agencyId?: string): Promise<AgencyOrganisationSettings | null> { return apiRequest(agencyId, '/api/v1/settings/organisation'); }
export async function saveOrganisationSettings(agencyId: string | undefined, settings: Omit<AgencyOrganisationSettings, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>): Promise<AgencyOrganisationSettings> {
  const { version, ...body } = settings; return apiRequest(agencyId, '/api/v1/settings/organisation', { method: 'PUT', body: { ...body, ...(version ? { expectedVersion: version } : {}) } });
}
export async function getOperationalSettings(agencyId?: string): Promise<AgencyOperationalSettings | null> { return apiRequest(agencyId, '/api/v1/settings/operational'); }
export async function saveOperationalSettings(agencyId: string | undefined, settings: Omit<AgencyOperationalSettings, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>): Promise<AgencyOperationalSettings> {
  const { version, ...body } = settings; return apiRequest(agencyId, '/api/v1/settings/operational', { method: 'PUT', body: { ...body, ...(version ? { expectedVersion: version } : {}) } });
}
export async function getCommunicationPolicy(agencyId?: string): Promise<CommunicationPolicy | null> { return apiRequest(agencyId, '/api/v1/settings/communications'); }
export async function saveCommunicationPolicy(agencyId: string | undefined, settings: Omit<CommunicationPolicy, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>): Promise<CommunicationPolicy> {
  const { version, ...body } = settings; return apiRequest(agencyId, '/api/v1/settings/communications', { method: 'PUT', body: { ...body, ...(version ? { expectedVersion: version } : {}) } });
}
export async function getMaintenancePolicy(agencyId?: string): Promise<MaintenancePolicySettings | null> { return apiRequest(agencyId, '/api/v1/settings/maintenance'); }
export async function saveMaintenancePolicy(agencyId: string | undefined, settings: Omit<MaintenancePolicySettings, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>): Promise<MaintenancePolicySettings> {
  const { version, ...body } = settings; return apiRequest(agencyId, '/api/v1/settings/maintenance', { method: 'PUT', body: { ...body, ...(version ? { expectedVersion: version } : {}) } });
}
export async function listBrandingProfiles(agencyId?: string): Promise<AgencyBrandingProfile[]> { return apiRequest(agencyId, '/api/v1/settings/branding'); }
export async function getActiveBranding(agencyId?: string): Promise<PublicAgencyBranding | null> { return apiRequest(agencyId, '/api/v1/settings/branding/active'); }
export async function createBrandingProfile(agencyId: string | undefined, profile: Omit<AgencyBrandingProfile, 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>): Promise<AgencyBrandingProfile> { return apiRequest(agencyId, '/api/v1/settings/branding', { method: 'POST', body: profile }); }
export async function updateBrandingProfile(agencyId: string | undefined, profile: AgencyBrandingProfile): Promise<AgencyBrandingProfile> {
  const {
    agencyId: ignoredAgencyId,
    createdAt: ignoredCreatedAt,
    updatedAt: ignoredUpdatedAt,
    ...body
  } = profile;
  void ignoredAgencyId;
  void ignoredCreatedAt;
  void ignoredUpdatedAt;
  return apiRequest(agencyId, `/api/v1/settings/branding/${encodeURIComponent(profile.id)}`, { method: 'PUT', body: { ...body, expectedVersion: profile.version ?? 1 } });
}
export async function listBrandingAssets(agencyId?: string): Promise<BrandingAsset[]> { return apiRequest(agencyId, '/api/v1/settings/branding/assets'); }
export async function createBrandingAsset(agencyId: string | undefined, asset: Omit<BrandingAsset, 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>): Promise<BrandingAsset> { return apiRequest(agencyId, '/api/v1/settings/branding/assets', { method: 'POST', body: asset }); }
export async function getSettingsOverview(agencyId?: string): Promise<SettingsOverview> { return apiRequest(agencyId, '/api/v1/settings/overview'); }