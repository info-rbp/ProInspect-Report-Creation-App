import type { InspectionReportType, PropertyUse } from './platform.js';
import type { SecurityCapability, SecurityRole } from './security.js';

export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'revoked';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export interface IdentityProfile {
  uid: string;
  email: string;
  displayName?: string;
  phone?: string;
  lastSignInAt?: string;
  createdAt?: string;
  emailVerified?: boolean;
  disabled?: boolean;
}

export interface PeopleInvitation {
  id: string;
  agencyId: string;
  email: string;
  displayName?: string;
  role: SecurityRole;
  status: InvitationStatus;
  mfaRequired: boolean;
  expiresAt: string;
  invitedBy: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  cancelledAt?: string;
  version?: number;
}

export interface WorkforceProfile {
  id: string;
  agencyId: string;
  userId: string;
  active: boolean;
  disciplines: Array<'inspection' | 'analysis' | 'review' | 'operations' | 'maintenance' | 'building_management' | 'strata'>;
  inspectionTypes: InspectionReportType[];
  propertyUses: PropertyUse[];
  serviceAreas: string[];
  commercialQualified: boolean;
  strataQualified: boolean;
  maxJobsPerDay?: number;
  maxActiveAnalyses?: number;
  maxActiveReviews?: number;
  defaultCalendarId?: string;
  workingHours?: Record<string, { start: string; end: string } | undefined>;
  unavailableDates?: string[];
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface WorkloadSummary {
  inspectionsToday: number;
  inspectionsNext7Days: number;
  activeAnalyses: number;
  activeReviews: number;
  overdueAssignments: number;
  capacityRemainingToday?: number;
}

export interface DeactivationImpact {
  userId: string;
  activeInspectionJobIds: string[];
  activeReportIds: string[];
  activeMaintenanceItemIds: string[];
  totalImpactedAssignments: number;
}

export interface ReassignmentResult {
  fromUserId: string;
  toUserId: string;
  inspectionJobsUpdated: number;
  reportsUpdated: number;
  maintenanceItemsUpdated: number;
  totalUpdated: number;
}

export interface PeopleDirectoryEntry {
  id: string;
  agencyId: string;
  email: string;
  displayName?: string;
  role: SecurityRole;
  membershipStatus: MembershipStatus;
  mfaRequired: boolean;
  effectiveCapabilities: SecurityCapability[];
  identity?: IdentityProfile;
  workforceProfile?: WorkforceProfile;
  workload?: WorkloadSummary;
  invitationExpiresAt?: string;
  updatedAt: string;
  version?: number;
}

export function isPrivilegedPeopleRole(role: SecurityRole): boolean {
  return [
    'super_admin', 'proinspect_admin', 'reviewer', 'operations', 'inspector',
    'building_manager', 'relief_building_manager', 'strata_manager', 'client_admin', 'contractor_admin',
  ].includes(role);
}

export function mayAssignRole(actorRole: SecurityRole, targetRole: SecurityRole): boolean {
  if (actorRole === 'super_admin') return true;
  if (actorRole !== 'proinspect_admin') return false;
  return targetRole !== 'super_admin';
}
