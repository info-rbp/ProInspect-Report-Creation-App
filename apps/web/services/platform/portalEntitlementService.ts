import type { PortalId, UnifiedRole } from '@pcr/domain';
import { apiRequest, storedAgencyId } from '../apiClient';

export interface PortalEntitlementRecord {
  id: string;
  agencyId: string;
  userId: string;
  portalId: PortalId;
  sourceRole: UnifiedRole;
  managedSiteId?: string;
  clientAccountId?: string;
  propertyId?: string;
  unitId?: string;
  contractorId?: string;
  permissions?: string | readonly string[];
  primary?: boolean;
  validFrom?: string;
  validUntil?: string;
  status: string;
  version?: number;
}

export interface PortalContext {
  entitlementId: string;
  portalId: PortalId;
  sourceRole: UnifiedRole;
  managedSiteId?: string;
  clientAccountId?: string;
  propertyId?: string;
  unitId?: string;
  contractorId?: string;
  primary: boolean;
}

export interface CurrentPortalMembership {
  uid: string;
  agencyId: string;
  role: UnifiedRole;
  mfaVerified: boolean;
  siteIds: string[];
  propertyIds: string[];
  clientAccountIds: string[];
  contractorId?: string;
}

function agency(): string {
  const agencyId = storedAgencyId();
  if (!agencyId) throw new Error('Select an agency before resolving portal access.');
  return agencyId;
}

export async function listMyPortalEntitlements(): Promise<PortalEntitlementRecord[]> {
  return apiRequest<PortalEntitlementRecord[]>(agency(), '/api/v1/platform/portal-entitlements/me');
}

export async function getMyPortalMembership(): Promise<CurrentPortalMembership> {
  return apiRequest<CurrentPortalMembership>(agency(), '/api/v1/platform/membership/me');
}

export function isActivePortalEntitlement(
  entitlement: Pick<PortalEntitlementRecord, 'status' | 'validFrom' | 'validUntil'>,
  now: Date = new Date(),
): boolean {
  if (entitlement.status !== 'active') return false;
  const timestamp = now.getTime();
  if (entitlement.validFrom && Date.parse(entitlement.validFrom) > timestamp) return false;
  if (entitlement.validUntil && Date.parse(entitlement.validUntil) <= timestamp) return false;
  return true;
}

export function activePortalEntitlements(
  entitlements: readonly PortalEntitlementRecord[],
  now: Date = new Date(),
): PortalEntitlementRecord[] {
  return entitlements.filter((item) => isActivePortalEntitlement(item, now));
}

export function portalContexts(
  entitlements: readonly PortalEntitlementRecord[],
  portalId: PortalId,
  now: Date = new Date(),
): PortalContext[] {
  return activePortalEntitlements(entitlements, now)
    .filter((item) => item.portalId === portalId)
    .map((item) => ({
      entitlementId: item.id,
      portalId: item.portalId,
      sourceRole: item.sourceRole,
      ...(item.managedSiteId ? { managedSiteId: item.managedSiteId } : {}),
      ...(item.clientAccountId ? { clientAccountId: item.clientAccountId } : {}),
      ...(item.propertyId ? { propertyId: item.propertyId } : {}),
      ...(item.unitId ? { unitId: item.unitId } : {}),
      ...(item.contractorId ? { contractorId: item.contractorId } : {}),
      primary: item.primary === true,
    }))
    .sort((left, right) => Number(right.primary) - Number(left.primary) || left.entitlementId.localeCompare(right.entitlementId));
}

export function contextLabel(context: PortalContext): string {
  const parts = [context.managedSiteId, context.unitId, context.clientAccountId, context.contractorId, context.propertyId]
    .filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(' · ') : context.sourceRole.replaceAll('_', ' ');
}
