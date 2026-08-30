import type { UserRole } from './platform.js';

/**
 * Portal roles are deliberately distinct from the legacy internal ProInspect role set.
 * A person can retain an agency role while receiving one or more scoped portal roles
 * through site, client, occupancy, assignment, or contractor memberships.
 */
export const PORTAL_ROLES = [
  'building_manager',
  'relief_building_manager',
  'strata_manager',
  'council_member',
  'resident_owner',
  'resident_tenant',
  'client_admin',
  'client_user',
  'contractor_admin',
  'contractor_worker',
] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];
export type UnifiedRole = UserRole | PortalRole;

export const PORTAL_IDS = [
  'admin',
  'inspector',
  'building',
  'strata',
  'resident',
  'client',
  'contractor',
] as const;
export type PortalId = (typeof PORTAL_IDS)[number];

export const BUILDING_MANAGEMENT_CAPABILITIES = [
  'managed_site.read',
  'managed_site.manage',
  'location.read',
  'location.manage',
  'building.activity.read',
  'building.activity.manage',
  'resident.request.read',
  'resident.request.create',
  'resident.request.manage',
  'defect.read',
  'defect.create',
  'defect.manage',
  'operational_work_order.read',
  'operational_work_order.manage',
  'contractor.read',
  'contractor.manage',
  'contractor.attendance.read',
  'contractor.attendance.manage',
  'contractor.compliance.read',
  'contractor.compliance.manage',
  'key_register.read',
  'key_register.manage',
  'access_device.read',
  'access_device.request',
  'access_device.manage',
  'move_booking.read',
  'move_booking.request',
  'move_booking.manage',
  'resident.read',
  'resident.manage',
  'operational_inspection.read',
  'operational_inspection.perform',
  'asset.read',
  'asset.manage',
  'maintenance_plan.read',
  'maintenance_plan.manage',
  'waste.read',
  'waste.manage',
  'incident.read',
  'incident.create',
  'incident.manage',
  'bylaw.read',
  'bylaw.create',
  'bylaw.decide',
  'operational_quote.read',
  'operational_quote.manage',
  'operational_approval.read',
  'operational_approval.decide',
  'building_notice.read',
  'building_notice.manage',
  'building_document.read',
  'building_document.manage',
  'operational_report.read',
  'operational_report.prepare',
  'operational_report.finalise',
  'building_task.read',
  'building_task.manage',
  'building_calendar.read',
  'building_calendar.manage',
  'handover.read',
  'handover.manage',
  'portal.switch',
  'offer.read',
  'offer.manage',
  'offer.redeem',
] as const;
export type BuildingManagementCapability = (typeof BUILDING_MANAGEMENT_CAPABILITIES)[number];

const ALL_BUILDING_CAPABILITIES = [...BUILDING_MANAGEMENT_CAPABILITIES] as const;
const SITE_OPERATIONS: readonly BuildingManagementCapability[] = [
  'managed_site.read', 'location.read', 'building.activity.read', 'building.activity.manage',
  'resident.request.read', 'resident.request.manage', 'defect.read', 'defect.create', 'defect.manage',
  'operational_work_order.read', 'operational_work_order.manage', 'contractor.read',
  'contractor.attendance.read', 'contractor.attendance.manage', 'contractor.compliance.read',
  'key_register.read', 'key_register.manage', 'access_device.read', 'access_device.manage',
  'move_booking.read', 'move_booking.manage', 'resident.read', 'resident.manage',
  'operational_inspection.read', 'operational_inspection.perform', 'asset.read', 'asset.manage',
  'maintenance_plan.read', 'maintenance_plan.manage', 'waste.read', 'waste.manage',
  'incident.read', 'incident.create', 'incident.manage', 'bylaw.read', 'bylaw.create',
  'operational_quote.read', 'operational_quote.manage', 'operational_approval.read',
  'building_notice.read', 'building_notice.manage', 'building_document.read', 'building_document.manage',
  'operational_report.read', 'operational_report.prepare', 'building_task.read', 'building_task.manage',
  'building_calendar.read', 'building_calendar.manage', 'handover.read', 'handover.manage',
  'portal.switch',
];
const STRATA_OVERSIGHT: readonly BuildingManagementCapability[] = [
  'managed_site.read', 'location.read', 'building.activity.read', 'resident.request.read',
  'defect.read', 'operational_work_order.read', 'contractor.read', 'contractor.attendance.read',
  'contractor.compliance.read', 'key_register.read', 'access_device.read', 'move_booking.read',
  'resident.read', 'operational_inspection.read', 'asset.read', 'maintenance_plan.read', 'waste.read',
  'incident.read', 'bylaw.read', 'bylaw.decide', 'operational_quote.read', 'operational_approval.read',
  'operational_approval.decide', 'building_notice.read', 'building_document.read',
  'operational_report.read', 'operational_report.finalise', 'building_task.read',
  'building_calendar.read', 'handover.read', 'portal.switch',
];
const RESIDENT_SELF_SERVICE: readonly BuildingManagementCapability[] = [
  'managed_site.read', 'location.read', 'resident.request.read', 'resident.request.create',
  'move_booking.read', 'move_booking.request', 'access_device.read', 'access_device.request',
  'building_notice.read', 'building_document.read', 'operational_report.read', 'offer.read',
  'offer.redeem', 'portal.switch',
];
const CONTRACTOR_SELF_SERVICE: readonly BuildingManagementCapability[] = [
  'managed_site.read', 'location.read', 'operational_work_order.read', 'contractor.attendance.read',
  'contractor.attendance.manage', 'contractor.compliance.read', 'key_register.read',
  'building_document.read', 'building_task.read', 'portal.switch',
];
const CLIENT_OVERSIGHT: readonly BuildingManagementCapability[] = [
  'managed_site.read', 'location.read', 'resident.request.read', 'defect.read',
  'operational_work_order.read', 'contractor.read', 'contractor.compliance.read',
  'operational_quote.read', 'operational_approval.read', 'operational_approval.decide',
  'operational_report.read', 'building_document.read', 'building_notice.read', 'portal.switch',
];

export const PORTAL_ROLE_CAPABILITIES: Readonly<Record<PortalRole, readonly BuildingManagementCapability[]>> = {
  building_manager: SITE_OPERATIONS,
  relief_building_manager: SITE_OPERATIONS,
  strata_manager: STRATA_OVERSIGHT,
  council_member: STRATA_OVERSIGHT.filter((item) => !['bylaw.decide', 'operational_approval.decide', 'operational_report.finalise'].includes(item)),
  resident_owner: RESIDENT_SELF_SERVICE,
  resident_tenant: RESIDENT_SELF_SERVICE,
  client_admin: CLIENT_OVERSIGHT,
  client_user: CLIENT_OVERSIGHT.filter((item) => item !== 'operational_approval.decide'),
  contractor_admin: CONTRACTOR_SELF_SERVICE,
  contractor_worker: CONTRACTOR_SELF_SERVICE,
};

export interface PortalDefinition {
  id: PortalId;
  route: `/${PortalId}`;
  name: string;
  summary: string;
  roles: readonly UnifiedRole[];
  primaryNavigation: readonly string[];
}

export const PORTAL_DEFINITIONS: readonly PortalDefinition[] = [
  {
    id: 'admin', route: '/admin', name: 'Admin Portal',
    summary: 'Run ProInspect, configure services, oversee operations, security, integrations and audit.',
    roles: ['super_admin', 'proinspect_admin', 'operations', 'analyst', 'reviewer'],
    primaryNavigation: ['Dashboard', 'Service Requests', 'Clients', 'Properties & Sites', 'Inspections', 'Reports', 'Maintenance', 'Building Management', 'Contractors', 'Communications', 'Documents', 'Compliance', 'Offers & Benefits', 'Users & Access', 'Integrations', 'Audit', 'Settings'],
  },
  {
    id: 'inspector', route: '/inspector', name: 'Inspector Portal',
    summary: 'Complete assigned inspections, evidence capture, issue identification, reports and offline sync.',
    roles: ['inspector'],
    primaryNavigation: ['Today', 'My Schedule', 'Assignments', 'Inspection', 'Photos & Evidence', 'Issues Identified', 'Reports', 'Keys & Access', 'Sync', 'Profile'],
  },
  {
    id: 'building', route: '/building', name: 'Building Management Portal',
    summary: 'Operate assigned buildings, residents, contractors, access, incidents and monthly reporting.',
    roles: ['building_manager', 'relief_building_manager'],
    primaryNavigation: ['Today', 'Quick Forms', 'Tasks', 'Inspections', 'Defects & Maintenance', 'Work Orders', 'Contractors', 'Moves & Deliveries', 'Residents & Units', 'Access Devices & Keys', 'Incidents & Security', 'By-law Observations', 'Assets', 'Waste', 'Calendar', 'Monthly Reports', 'Handover'],
  },
  {
    id: 'strata', route: '/strata', name: 'Strata Portal',
    summary: 'Provide scheme oversight, approvals, governance, reports, notices and audit.',
    roles: ['strata_manager', 'council_member'],
    primaryNavigation: ['Dashboard', 'Reports', 'Approvals', 'Maintenance', 'Contractors', 'Residents', 'Access', 'Incidents', 'By-laws', 'Notices', 'Documents', 'Users', 'Audit'],
  },
  {
    id: 'resident', route: '/resident', name: 'Resident Portal',
    summary: 'Give owners, residents and tenants location-aware self-service for requests, bookings and documents.',
    roles: ['resident_owner', 'resident_tenant', 'tenant'],
    primaryNavigation: ['Home', 'My Property', 'Issues & Requests', 'Maintenance', 'Inspections', 'Bookings', 'Access & Keys', 'Documents', 'Messages', 'Building Notices', 'Offers & Benefits', 'My Household', 'Profile'],
  },
  {
    id: 'client', route: '/client', name: 'Client Portal',
    summary: 'Manage portfolio services, inspections, reports, approvals, documents and communications.',
    roles: ['client_admin', 'client_user', 'landlord'],
    primaryNavigation: ['Dashboard', 'Properties', 'Service Requests', 'Inspections', 'Reports', 'Maintenance', 'Quotes & Approvals', 'Documents', 'Compliance', 'Contacts & Team', 'Portal Users', 'Commercial Terms', 'Integrations'],
  },
  {
    id: 'contractor', route: '/contractor', name: 'Contractor Portal',
    summary: 'Receive work, manage attendance and access, submit quotes, evidence and compliance documents.',
    roles: ['contractor_admin', 'contractor_worker'],
    primaryNavigation: ['Home', 'Assigned Work', 'Schedule', 'Site Access', 'Check In / Out', 'Work Orders', 'Quotes', 'Evidence', 'Documents', 'Compliance', 'My Company', 'Notifications'],
  },
] as const;

export function portalDefinitionsForRole(role: UnifiedRole | undefined): readonly PortalDefinition[] {
  if (!role) return [];
  if (role === 'super_admin' || role === 'proinspect_admin') return PORTAL_DEFINITIONS;
  return PORTAL_DEFINITIONS.filter((portal) => portal.roles.includes(role));
}

export function portalRoleHasCapability(role: PortalRole | undefined, capability: BuildingManagementCapability): boolean {
  return Boolean(role && PORTAL_ROLE_CAPABILITIES[role].includes(capability));
}

export type LocationNodeType = 'site' | 'building' | 'level' | 'unit' | 'common_area' | 'room' | 'asset_location' | 'parking' | 'storage';
export interface LocationNode {
  id: string;
  agencyId: string;
  managedSiteId: string;
  type: LocationNodeType;
  name: string;
  parentId?: string;
  propertyId?: string;
  buildingId?: string;
  unitId?: string;
  responsibility?: 'lot' | 'common_property' | 'exclusive_use' | 'shared' | 'unknown';
  status: 'active' | 'inactive' | 'archived';
}

export type ResidentRelationshipType = 'owner' | 'tenant' | 'resident' | 'authorised_occupant' | 'non_occupying_owner';
export interface ResidentLocationRelationship {
  id: string;
  agencyId: string;
  userId: string;
  managedSiteId: string;
  buildingId?: string;
  unitId?: string;
  propertyId?: string;
  relationshipType: ResidentRelationshipType;
  startDate?: string;
  endDate?: string;
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'expired';
}

export type DefectStatus = 'new' | 'bm_assessment' | 'minor_repair' | 'contractor_required' | 'awaiting_approval' | 'approved' | 'contractor_booked' | 'in_progress' | 'awaiting_verification' | 'completed' | 'closed';
const DEFECT_TRANSITIONS: Readonly<Record<DefectStatus, readonly DefectStatus[]>> = {
  new: ['bm_assessment'],
  bm_assessment: ['minor_repair', 'contractor_required'],
  minor_repair: ['awaiting_verification', 'completed'],
  contractor_required: ['awaiting_approval', 'approved', 'contractor_booked'],
  awaiting_approval: ['approved', 'bm_assessment'],
  approved: ['contractor_booked'],
  contractor_booked: ['in_progress'],
  in_progress: ['awaiting_verification'],
  awaiting_verification: ['completed', 'in_progress'],
  completed: ['closed'],
  closed: [],
};
export function canTransitionDefect(from: DefectStatus, to: DefectStatus): boolean { return DEFECT_TRANSITIONS[from].includes(to); }
export function canCloseDefect(input: { status: DefectStatus; hasCompletionEvidence: boolean; verifiedByUserId?: string | null }): { allowed: boolean; reason?: string } {
  if (input.status !== 'completed') return { allowed: false, reason: 'Defect must be completed before closing.' };
  if (!input.hasCompletionEvidence) return { allowed: false, reason: 'Completion evidence is required before closing.' };
  if (!input.verifiedByUserId) return { allowed: false, reason: 'Building Manager verification is required before closing.' };
  return { allowed: true };
}

export type OperationalWorkOrderStatus = 'created' | 'scheduled' | 'in_progress' | 'completed' | 'verified' | 'cancelled';
const WORK_ORDER_TRANSITIONS: Readonly<Record<OperationalWorkOrderStatus, readonly OperationalWorkOrderStatus[]>> = {
  created: ['scheduled', 'cancelled'], scheduled: ['in_progress', 'cancelled'], in_progress: ['completed'], completed: ['verified'], verified: [], cancelled: [],
};
export function canTransitionOperationalWorkOrder(from: OperationalWorkOrderStatus, to: OperationalWorkOrderStatus): boolean { return WORK_ORDER_TRANSITIONS[from].includes(to); }

export type MoveBookingStatus = 'new' | 'pending_approval' | 'approved' | 'declined' | 'pre_move_setup' | 'in_progress' | 'post_move_inspection' | 'closed';
const MOVE_TRANSITIONS: Readonly<Record<MoveBookingStatus, readonly MoveBookingStatus[]>> = {
  new: ['pending_approval'], pending_approval: ['approved', 'declined'], approved: ['pre_move_setup'], declined: [], pre_move_setup: ['in_progress'], in_progress: ['post_move_inspection'], post_move_inspection: ['closed'], closed: [],
};
export function canTransitionMoveBooking(from: MoveBookingStatus, to: MoveBookingStatus): boolean { return MOVE_TRANSITIONS[from].includes(to); }
export function canCloseMoveBooking(input: { status: MoveBookingStatus; keysReturned: boolean; hasPostMoveInspection: boolean }): { allowed: boolean; reason?: string } {
  if (input.status !== 'post_move_inspection') return { allowed: false, reason: 'Move must be in post-move inspection status.' };
  if (!input.keysReturned) return { allowed: false, reason: 'Keys and access items must be returned.' };
  if (!input.hasPostMoveInspection) return { allowed: false, reason: 'A post-move inspection is required.' };
  return { allowed: true };
}

export type AccessDeviceRequestStatus = 'submitted' | 'awaiting_authorisation' | 'approved' | 'programming' | 'ready_for_collection' | 'issued' | 'declined';
const ACCESS_DEVICE_TRANSITIONS: Readonly<Record<AccessDeviceRequestStatus, readonly AccessDeviceRequestStatus[]>> = {
  submitted: ['awaiting_authorisation', 'approved', 'declined'], awaiting_authorisation: ['approved', 'declined'], approved: ['programming'], programming: ['ready_for_collection'], ready_for_collection: ['issued'], issued: [], declined: [],
};
export function canTransitionAccessDeviceRequest(from: AccessDeviceRequestStatus, to: AccessDeviceRequestStatus): boolean { return ACCESS_DEVICE_TRANSITIONS[from].includes(to); }

export function canSignOutContractorAttendance(input: { keyIssued: boolean; keyReturned: boolean; overrideReason?: string | null }): { allowed: boolean; requiresOverride: boolean; reason?: string } {
  if (!input.keyIssued || input.keyReturned) return { allowed: true, requiresOverride: false };
  if (input.overrideReason?.trim()) return { allowed: true, requiresOverride: true };
  return { allowed: false, requiresOverride: true, reason: 'A key or access item remains outstanding; a Building Manager override and reason are required.' };
}

export function isImmediateOperationalEscalation(riskLevel: string): boolean {
  return riskLevel === 'high' || riskLevel === 'immediate_danger';
}

export type ContractorComplianceStatus = 'valid' | 'expiring' | 'expired' | 'suspended' | 'not_configured';
export function contractorComplianceStatus(input: { suspended?: boolean; licenceExpiresAt?: string; insuranceExpiresAt?: string; complianceExpiresAt?: string; now?: Date; warningDays?: number }): ContractorComplianceStatus {
  if (input.suspended) return 'suspended';
  const dates = [input.licenceExpiresAt, input.insuranceExpiresAt, input.complianceExpiresAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()));
  if (!dates.length) return 'not_configured';
  const now = input.now ?? new Date();
  if (dates.some((value) => value.getTime() < now.getTime())) return 'expired';
  const threshold = now.getTime() + (input.warningDays ?? 30) * 86_400_000;
  return dates.some((value) => value.getTime() <= threshold) ? 'expiring' : 'valid';
}

export type OfferRedemptionType = 'external_link' | 'promo_code' | 'unique_code' | 'shopify_discount';
export interface OfferPartner {
  id: string; agencyId: string; name: string; logoFileId?: string; contactEmail?: string; agreementStatus: 'draft' | 'active' | 'suspended' | 'expired'; privacyConfiguration?: Record<string, unknown>;
}
export interface Offer {
  id: string; agencyId: string; partnerId: string; title: string; description: string; category: string; terms?: string; validFrom: string; validUntil: string; audienceRules: Record<string, unknown>; locationRules: Record<string, unknown>; redemptionType: OfferRedemptionType; status: 'draft' | 'active' | 'paused' | 'expired' | 'archived';
}
export interface OfferRedemption {
  id: string; agencyId: string; offerId: string; userId: string; redeemedAt: string; redemptionToken?: string; status: 'created' | 'redeemed' | 'expired' | 'cancelled'; externalReference?: string;
}

export const STRATA_SOURCE_TABLES = [
  'access_device_history', 'access_device_requests', 'access_devices', 'approvals', 'assets', 'audit_events',
  'buildings', 'bylaw_observations', 'calendar_events', 'communications', 'contractor_attendance', 'contractors',
  'daily_activity_logs', 'defect_evidence', 'defects', 'documents', 'form_submissions', 'handover_checklist_items',
  'handovers', 'incidents', 'inspection_checkpoints', 'inspection_results', 'inspection_templates', 'inspections',
  'integration_outbox', 'inventory_items', 'key_transactions', 'keys_register', 'locations', 'maintenance_plans',
  'monthly_report_drafts', 'move_bookings', 'notices', 'notifications', 'occupancies', 'people', 'properties',
  'property_operating_settings', 'quotes', 'resident_onboarding', 'resident_requests', 'service_events', 'sessions',
  'tasks', 'units', 'users', 'waste_events', 'waste_services', 'work_orders',
] as const;

export const STRATA_FEATURE_PARITY = [
  { capability: 'Daily activity diary', destination: 'daily_activity_logs', portals: ['building', 'admin'] },
  { capability: 'Resident requests', destination: 'resident_requests', portals: ['resident', 'building', 'strata'] },
  { capability: 'Defects', destination: 'defects', portals: ['building', 'strata', 'contractor'] },
  { capability: 'Operational work orders', destination: 'operational_work_orders', portals: ['building', 'strata', 'contractor'] },
  { capability: 'Contractor management and attendance', destination: 'contractors, contractor_attendance', portals: ['building', 'strata', 'contractor'] },
  { capability: 'Controlled keys', destination: 'key_register, key_transactions', portals: ['building', 'contractor'] },
  { capability: 'Access devices', destination: 'access_device_requests, access_devices, access_device_history', portals: ['resident', 'building', 'strata'] },
  { capability: 'Move bookings', destination: 'move_bookings', portals: ['resident', 'building', 'strata'] },
  { capability: 'Resident onboarding', destination: 'resident_onboarding, occupancies', portals: ['resident', 'building'] },
  { capability: 'Operational inspections', destination: 'operational_inspections, operational_inspection_checkpoints, operational_inspection_results', portals: ['building', 'strata'] },
  { capability: 'Assets and preventive maintenance', destination: 'assets, maintenance_plans, service_events', portals: ['building', 'strata', 'contractor'] },
  { capability: 'Waste operations', destination: 'waste_services, waste_events', portals: ['building', 'strata'] },
  { capability: 'Incidents and security', destination: 'incidents', portals: ['building', 'strata', 'resident'] },
  { capability: 'By-law observations', destination: 'bylaw_observations', portals: ['building', 'strata'] },
  { capability: 'Quotes and approvals', destination: 'operational_quotes, operational_approvals', portals: ['building', 'strata', 'client', 'contractor'] },
  { capability: 'Notices and communications', destination: 'notices, communications, notifications', portals: ['building', 'strata', 'resident', 'client', 'contractor'] },
  { capability: 'Documents and evidence', destination: 'documents, evidence_files', portals: ['admin', 'building', 'strata', 'resident', 'client', 'contractor'] },
  { capability: 'Monthly reports', destination: 'operational_report_drafts, operational_reports', portals: ['building', 'strata', 'client'] },
  { capability: 'Handover', destination: 'handovers, handover_checklist_items', portals: ['building'] },
  { capability: 'Audit', destination: 'audit_events', portals: ['admin', 'strata'] },
] as const;

export function assertFinalOperationalReportImmutable(input: { immutable: boolean; existingFinalisedAt?: string; requestedMutation: 'update' | 'delete' | 'supersede' }): void {
  if (input.immutable && input.existingFinalisedAt && input.requestedMutation !== 'supersede') {
    throw Object.assign(new Error('Finalised operational reports are immutable and must be superseded.'), { code: 'OPERATIONAL_REPORT_IMMUTABLE' });
  }
}

void ALL_BUILDING_CAPABILITIES;
