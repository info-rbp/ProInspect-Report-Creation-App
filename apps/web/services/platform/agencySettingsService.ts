import type {
  AgencyBrandingProfile,
  AgencyOperationalSettings,
  AgencyOrganisationSettings,
  CommunicationPolicy,
  MaintenancePolicySettings,
  SettingsOverview,
} from '../../types/platform';
import { apiRequest } from '../apiClient';

export async function getOrganisationSettings(agencyId?: string): Promise<AgencyOrganisationSettings | null> {
  return apiRequest<AgencyOrganisationSettings | null>(agencyId, '/api/v1/settings/organisation');
}

export async function saveOrganisationSettings(
  agencyId: string | undefined,
  settings: Omit<AgencyOrganisationSettings, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>,
): Promise<AgencyOrganisationSettings> {
  const { version, ...body } = settings;
  return apiRequest<AgencyOrganisationSettings>(agencyId, '/api/v1/settings/organisation', {
    method: 'PUT',
    body: { ...body, ...(version ? { expectedVersion: version } : {}) },
  });
}

export async function getOperationalSettings(agencyId?: string): Promise<AgencyOperationalSettings | null> {
  return apiRequest<AgencyOperationalSettings | null>(agencyId, '/api/v1/settings/operational');
}

export async function saveOperationalSettings(
  agencyId: string | undefined,
  settings: Omit<AgencyOperationalSettings, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>,
): Promise<AgencyOperationalSettings> {
  const { version, ...body } = settings;
  return apiRequest<AgencyOperationalSettings>(agencyId, '/api/v1/settings/operational', {
    method: 'PUT', body: { ...body, ...(version ? { expectedVersion: version } : {}) },
  });
}

export async function getCommunicationPolicy(agencyId?: string): Promise<CommunicationPolicy | null> {
  return apiRequest<CommunicationPolicy | null>(agencyId, '/api/v1/settings/communications');
}

export async function saveCommunicationPolicy(
  agencyId: string | undefined,
  settings: Omit<CommunicationPolicy, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>,
): Promise<CommunicationPolicy> {
  const { version, ...body } = settings;
  return apiRequest<CommunicationPolicy>(agencyId, '/api/v1/settings/communications', {
    method: 'PUT', body: { ...body, ...(version ? { expectedVersion: version } : {}) },
  });
}

export async function getMaintenancePolicy(agencyId?: string): Promise<MaintenancePolicySettings | null> {
  return apiRequest<MaintenancePolicySettings | null>(agencyId, '/api/v1/settings/maintenance');
}

export async function saveMaintenancePolicy(
  agencyId: string | undefined,
  settings: Omit<MaintenancePolicySettings, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>,
): Promise<MaintenancePolicySettings> {
  const { version, ...body } = settings;
  return apiRequest<MaintenancePolicySettings>(agencyId, '/api/v1/settings/maintenance', {
    method: 'PUT', body: { ...body, ...(version ? { expectedVersion: version } : {}) },
  });
}

export async function listBrandingProfiles(agencyId?: string): Promise<AgencyBrandingProfile[]> {
  return apiRequest<AgencyBrandingProfile[]>(agencyId, '/api/v1/settings/branding');
}

export async function getSettingsOverview(agencyId?: string): Promise<SettingsOverview> {
  return apiRequest<SettingsOverview>(agencyId, '/api/v1/settings/overview');
}
