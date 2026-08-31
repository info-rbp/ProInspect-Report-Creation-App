import type { PortalId } from '@pcr/domain';
import type { PortalResourceSource } from '../portalResourceApi';

export type PortalFeatureKind = 'dashboard' | 'resource' | 'internal' | 'quick-actions' | 'profile' | 'client-workspace';
export type PortalContextRequirement = 'none' | 'site' | 'client' | 'contractor' | 'property';

export interface PortalCreateField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'date' | 'datetime-local' | 'number' | 'checkbox';
  required?: boolean;
  placeholder?: string;
}

export interface PortalResourceBinding {
  source: PortalResourceSource;
  resource: string;
  label: string;
  context: PortalContextRequirement;
}

export interface PortalFeatureDefinition {
  portalId: PortalId;
  slug: string;
  label: string;
  summary: string;
  kind: PortalFeatureKind;
  internalPath?: string;
  resources?: readonly PortalResourceBinding[];
  createFields?: readonly PortalCreateField[];
  transitionResource?: 'defects' | 'operational-work-orders' | 'move-bookings' | 'access-device-requests';
  transitionStatuses?: readonly string[];
  quickActions?: readonly string[];
}

const building = (resource: string, label: string, context: PortalContextRequirement = 'site'): PortalResourceBinding => ({ source: 'building', resource, label, context });
const platform = (resource: string, label: string, context: PortalContextRequirement = 'none'): PortalResourceBinding => ({ source: 'platform', resource, label, context });
const feature = (portalId: PortalId, slug: string, label: string, summary: string, kind: PortalFeatureKind, extras: Omit<PortalFeatureDefinition, 'portalId' | 'slug' | 'label' | 'summary' | 'kind'> = {}): PortalFeatureDefinition => ({ portalId, slug, label, summary, kind, ...extras });

const activityFields: readonly PortalCreateField[] = [
  { name: 'activityDate', label: 'Activity date', type: 'datetime-local', required: true },
  { name: 'category', label: 'Category', required: true, placeholder: 'Operations, resident, contractor…' },
  { name: 'summary', label: 'Summary', type: 'textarea', required: true },
  { name: 'actionTaken', label: 'Action taken', type: 'textarea' },
];
const taskFields: readonly PortalCreateField[] = [
  { name: 'title', label: 'Task', required: true },
  { name: 'taskType', label: 'Type', required: true },
  { name: 'priority', label: 'Priority', placeholder: 'normal / high / urgent' },
  { name: 'dueAt', label: 'Due', type: 'datetime-local' },
];
const residentRequestFields: readonly PortalCreateField[] = [
  { name: 'requestType', label: 'Request type', required: true, placeholder: 'issue / maintenance / access / other' },
  { name: 'category', label: 'Category' },
  { name: 'urgency', label: 'Urgency', placeholder: 'low / normal / high / urgent' },
  { name: 'description', label: 'Describe the issue or request', type: 'textarea', required: true },
  { name: 'accessPermission', label: 'Management may access if required', type: 'checkbox' },
  { name: 'accessInstructions', label: 'Access instructions', type: 'textarea' },
];
const incidentFields: readonly PortalCreateField[] = [
  { name: 'category', label: 'Category', required: true },
  { name: 'severity', label: 'Severity', required: true },
  { name: 'description', label: 'Incident details', type: 'textarea', required: true },
  { name: 'immediateActions', label: 'Immediate actions', type: 'textarea' },
];
const bylawFields: readonly PortalCreateField[] = [
  { name: 'category', label: 'By-law category', required: true },
  { name: 'observation', label: 'Observation', type: 'textarea', required: true },
  { name: 'occurredAt', label: 'Observed at', type: 'datetime-local' },
];
const moveFields: readonly PortalCreateField[] = [
  { name: 'propertyId', label: 'Property ID', required: true },
  { name: 'moveType', label: 'Move type', required: true, placeholder: 'move_in / move_out / delivery' },
  { name: 'startAt', label: 'Start', type: 'datetime-local', required: true },
  { name: 'endAt', label: 'End', type: 'datetime-local', required: true },
  { name: 'removalistName', label: 'Removalist / supplier' },
  { name: 'specialRequirements', label: 'Special requirements', type: 'textarea' },
];
const accessRequestFields: readonly PortalCreateField[] = [
  { name: 'unitId', label: 'Unit ID', required: true },
  { name: 'requestType', label: 'Request type', required: true },
  { name: 'deviceTypeRequested', label: 'Device type', required: true },
  { name: 'quantityRequested', label: 'Quantity', type: 'number' },
  { name: 'requestReason', label: 'Reason', type: 'textarea' },
];
const offerFields: readonly PortalCreateField[] = [
  { name: 'partnerId', label: 'Partner ID', required: true },
  { name: 'title', label: 'Offer title', required: true },
  { name: 'category', label: 'Category', required: true },
  { name: 'description', label: 'Description', type: 'textarea', required: true },
  { name: 'validFrom', label: 'Valid from', type: 'datetime-local', required: true },
  { name: 'validUntil', label: 'Valid until', type: 'datetime-local', required: true },
  { name: 'redemptionType', label: 'Redemption type', required: true, placeholder: 'external_link / promo_code / unique_code / shopify_discount' },
];
const conversationFields: readonly PortalCreateField[] = [
  { name: 'subject', label: 'Subject', required: true },
  { name: 'linkedEntityType', label: 'Related record type', required: true, placeholder: 'property / request / work_order / incident' },
  { name: 'linkedEntityId', label: 'Related record ID', required: true },
  { name: 'conversationState', label: 'State', required: true, placeholder: 'open' },
];
const bookingFields: readonly PortalCreateField[] = [
  { name: 'serviceRequestId', label: 'Service request ID', required: true },
  { name: 'startAt', label: 'Start', type: 'datetime-local', required: true },
  { name: 'endAt', label: 'End', type: 'datetime-local', required: true },
  { name: 'bookingState', label: 'State', required: true, placeholder: 'requested' },
  { name: 'accessInstructions', label: 'Access instructions', type: 'textarea' },
];

export const PORTAL_FEATURES: readonly PortalFeatureDefinition[] = [
  // Admin
  feature('admin', 'dashboard', 'Dashboard', 'Operational KPIs, exceptions and work requiring attention.', 'internal', { internalPath: '/app/dashboard' }),
  feature('admin', 'service-requests', 'Service Requests', 'Commerce and manually created services routed into canonical workflows.', 'resource', { resources: [platform('service-requests', 'Service requests')] }),
  feature('admin', 'clients', 'Clients', 'Client accounts, contacts, relationships and commercial context.', 'internal', { internalPath: '/app/admin/clients' }),
  feature('admin', 'properties-sites', 'Properties & Sites', 'Properties, strata schemes, buildings and operational locations.', 'internal', { internalPath: '/app/admin/properties' }),
  feature('admin', 'inspections', 'Inspections', 'Inspection requests, assignments, schedules and field progress.', 'internal', { internalPath: '/app/admin/jobs' }),
  feature('admin', 'reports', 'Reports', 'Review, issue and manage immutable inspection reports.', 'internal', { internalPath: '/app/admin/reports' }),
  feature('admin', 'maintenance', 'Maintenance', 'Triage, quotes, work orders and verification.', 'internal', { internalPath: '/app/admin/maintenance' }),
  feature('admin', 'building-management', 'Building Management', 'Cross-site oversight of Building Management operations.', 'dashboard', { resources: [building('defects', 'Defects'), building('operational-work-orders', 'Work orders'), building('incidents', 'Incidents')] }),
  feature('admin', 'contractors', 'Contractors', 'Contractor directory, attendance and compliance.', 'resource', { resources: [building('contractors', 'Contractors', 'none'), platform('contractor-compliance', 'Compliance', 'contractor')] }),
  feature('admin', 'communications', 'Communications', 'Governed communications and conversations.', 'internal', { internalPath: '/app/admin/communications' }),
  feature('admin', 'documents', 'Documents', 'Property, tenancy and operational document workflows.', 'internal', { internalPath: '/app/admin/tenants/documents' }),
  feature('admin', 'compliance', 'Compliance', 'Compliance rules, assessments and exceptions.', 'internal', { internalPath: '/app/admin/compliance' }),
  feature('admin', 'offers-benefits', 'Offers & Benefits', 'Partners, eligibility, targeting and resident redemptions.', 'resource', { resources: [platform('offers', 'Offers')], createFields: offerFields }),
  feature('admin', 'users-access', 'Users & Access', 'Identity, roles, scopes, MFA and portal access.', 'internal', { internalPath: '/app/admin/users' }),
  feature('admin', 'integrations', 'Integrations', 'Shopify, Google Calendar and integration exception management.', 'internal', { internalPath: '/app/admin/settings/integrations' }),
  feature('admin', 'audit', 'Audit', 'Immutable security and operational activity history.', 'resource', { resources: [platform('audit-events', 'Audit events')] }),
  feature('admin', 'settings', 'Settings', 'Organisation, security, workflow and communication settings.', 'internal', { internalPath: '/app/admin/settings' }),

  // Inspector
  feature('inspector', 'today', 'Today', 'Today’s assigned inspections and field priorities.', 'internal', { internalPath: '/app/admin/jobs' }),
  feature('inspector', 'my-schedule', 'My Schedule', 'Calendar and route planning for assigned work.', 'internal', { internalPath: '/app/admin/jobs/planner' }),
  feature('inspector', 'assignments', 'Assignments', 'Upcoming, active, overdue and completed assignments.', 'internal', { internalPath: '/app/admin/jobs' }),
  feature('inspector', 'inspection', 'Inspection', 'Open an assigned job and conduct the field inspection.', 'internal', { internalPath: '/app/admin/jobs' }),
  feature('inspector', 'photos-evidence', 'Photos & Evidence', 'Capture and upload evidence attached to assigned inspection work.', 'internal', { internalPath: '/app/admin/jobs' }),
  feature('inspector', 'issues-identified', 'Issues Identified', 'Maintenance and defects identified during inspection.', 'internal', { internalPath: '/app/admin/maintenance' }),
  feature('inspector', 'reports', 'Reports', 'Draft reports requiring inspector input.', 'internal', { internalPath: '/app/admin/reports' }),
  feature('inspector', 'keys-access', 'Keys & Access', 'Property access instructions and controlled key workflows.', 'internal', { internalPath: '/app/admin/keys' }),
  feature('inspector', 'sync', 'Sync', 'Offline submissions, conflicts and retry state for this device.', 'resource', { resources: [platform('offline-sync-receipts', 'Sync receipts', 'none')] }),
  feature('inspector', 'profile', 'Profile', 'Inspector identity, availability and operational preferences.', 'profile'),

  // Building Management
  feature('building', 'today', 'Today', 'Urgent defects, contractors on site, tasks, incidents and scheduled work.', 'dashboard', { resources: [building('tasks', 'Tasks'), building('defects', 'Defects'), building('contractor-attendance', 'Contractors on site'), building('incidents', 'Incidents'), building('calendar-events', 'Calendar')] }),
  feature('building', 'quick-forms', 'Quick Forms', 'Fast operational capture for the most common Building Management events.', 'quick-actions', { quickActions: ['activity', 'tasks', 'defects-maintenance', 'incidents-security', 'bylaw-observations', 'waste'] }),
  feature('building', 'tasks', 'Tasks', 'Site-scoped operational tasks and due work.', 'resource', { resources: [building('tasks', 'Tasks')], createFields: taskFields }),
  feature('building', 'inspections', 'Inspections', 'Common-area and operational inspections.', 'resource', { resources: [building('operational-inspections', 'Operational inspections')] }),
  feature('building', 'defects-maintenance', 'Defects & Maintenance', 'Operational defects, risk, assignment and maintenance planning.', 'resource', { resources: [building('defects', 'Defects'), building('maintenance-plans', 'Maintenance plans')], transitionResource: 'defects', transitionStatuses: ['bm_assessment', 'minor_repair', 'contractor_required', 'awaiting_approval', 'approved', 'contractor_booked', 'in_progress', 'awaiting_verification', 'completed', 'closed'] }),
  feature('building', 'work-orders', 'Work Orders', 'Operational contractor work orders and verification.', 'resource', { resources: [building('operational-work-orders', 'Work orders')], transitionResource: 'operational-work-orders', transitionStatuses: ['scheduled', 'in_progress', 'completed', 'verified', 'cancelled'] }),
  feature('building', 'contractors', 'Contractors', 'Directory, site attendance and compliance state.', 'resource', { resources: [building('contractors', 'Contractors', 'none'), building('contractor-attendance', 'Attendance'), platform('contractor-compliance', 'Compliance', 'contractor')] }),
  feature('building', 'moves-deliveries', 'Moves & Deliveries', 'Move bookings, logistics approvals and post-move closure.', 'resource', { resources: [building('move-bookings', 'Move bookings')], createFields: moveFields, transitionResource: 'move-bookings', transitionStatuses: ['pending_approval', 'approved', 'declined', 'pre_move_setup', 'in_progress', 'post_move_inspection', 'closed'] }),
  feature('building', 'residents-units', 'Residents & Units', 'Current occupancies, units and onboarding status.', 'resource', { resources: [building('units', 'Units'), building('occupancies', 'Occupancies'), building('resident-onboarding', 'Onboarding')] }),
  feature('building', 'access-devices-keys', 'Access Devices & Keys', 'Access-device requests, issued devices, controlled keys and custody.', 'resource', { resources: [building('access-device-requests', 'Access requests'), building('access-devices', 'Access devices'), building('key-register', 'Key register'), building('key-transactions', 'Key transactions')], createFields: accessRequestFields, transitionResource: 'access-device-requests', transitionStatuses: ['reviewing', 'awaiting_authorisation', 'awaiting_payment', 'approved', 'ready_for_collection', 'collected', 'declined', 'cancelled'] }),
  feature('building', 'incidents-security', 'Incidents & Security', 'Incident register, immediate response and follow-up.', 'resource', { resources: [building('incidents', 'Incidents')], createFields: incidentFields }),
  feature('building', 'bylaw-observations', 'By-law Observations', 'Observed by-law matters and decision outcomes.', 'resource', { resources: [building('bylaw-observations', 'By-law observations')], createFields: bylawFields }),
  feature('building', 'assets', 'Assets', 'Asset register, QR identities, service schedules and history.', 'resource', { resources: [building('assets', 'Assets'), building('maintenance-plans', 'Maintenance plans'), building('service-events', 'Service history')] }),
  feature('building', 'waste', 'Waste', 'Waste-service configuration and operational waste events.', 'resource', { resources: [building('waste-services', 'Waste services'), building('waste-events', 'Waste events')] }),
  feature('building', 'calendar', 'Calendar', 'Site events, moves, contractors and scheduled work.', 'resource', { resources: [building('calendar-events', 'Calendar')] }),
  feature('building', 'monthly-reports', 'Monthly Reports', 'Prepare, review and read immutable Building Management reports.', 'resource', { resources: [building('operational-report-drafts', 'Drafts'), building('operational-reports', 'Final reports')] }),
  feature('building', 'handover', 'Handover', 'Relief and permanent Building Manager handovers and checklists.', 'resource', { resources: [building('handovers', 'Handovers'), building('handover-checklist-items', 'Checklist')] }),
  feature('building', 'activity', 'Activity Diary', 'Daily Building Management operational activity.', 'resource', { resources: [building('daily-activity-logs', 'Activity')], createFields: activityFields }),

  // Strata
  feature('strata', 'dashboard', 'Dashboard', 'Scheme status, decisions, exceptions and operational trends.', 'dashboard', { resources: [building('defects', 'Defects'), building('operational-approvals', 'Approvals'), building('incidents', 'Incidents'), building('operational-reports', 'Reports')] }),
  feature('strata', 'reports', 'Reports', 'Final Building Management monthly and operational reports.', 'resource', { resources: [building('operational-reports', 'Reports')] }),
  feature('strata', 'approvals', 'Approvals', 'Quote and expenditure decisions requiring strata authority.', 'resource', { resources: [building('operational-approvals', 'Approvals'), building('operational-quotes', 'Quotes')] }),
  feature('strata', 'maintenance', 'Maintenance', 'Defect and operational work-order progress.', 'resource', { resources: [building('defects', 'Defects'), building('operational-work-orders', 'Work orders')] }),
  feature('strata', 'contractors', 'Contractors', 'Contractor directory, attendance and current compliance.', 'resource', { resources: [building('contractors', 'Contractors', 'none'), building('contractor-attendance', 'Attendance'), platform('contractor-compliance', 'Compliance', 'contractor')] }),
  feature('strata', 'residents', 'Residents', 'Units, current occupancies and resident onboarding.', 'resource', { resources: [building('units', 'Units'), building('occupancies', 'Occupancies'), building('resident-onboarding', 'Onboarding')] }),
  feature('strata', 'access', 'Access', 'Access devices, requests and controlled-key status.', 'resource', { resources: [building('access-device-requests', 'Requests'), building('access-devices', 'Devices'), building('key-register', 'Keys')] }),
  feature('strata', 'incidents', 'Incidents', 'Security and incident register with follow-up.', 'resource', { resources: [building('incidents', 'Incidents')] }),
  feature('strata', 'bylaws', 'By-laws', 'By-law observations, decisions and outcomes.', 'resource', { resources: [building('bylaw-observations', 'By-law observations')] }),
  feature('strata', 'notices', 'Notices', 'Published building and scheme communications.', 'resource', { resources: [building('notices', 'Notices')] }),
  feature('strata', 'documents', 'Documents', 'Scheme and operational documents within approved visibility.', 'resource', { resources: [building('documents', 'Documents')] }),
  feature('strata', 'users', 'Users', 'Site memberships and role-scoped portal access.', 'resource', { resources: [building('site-memberships', 'Site memberships')] }),
  feature('strata', 'audit', 'Audit', 'Site-scoped immutable operational audit history.', 'resource', { resources: [building('audit-events', 'Audit events')] }),

  // Resident
  feature('resident', 'home', 'Home', 'Property, requests, bookings, notices and actions requiring attention.', 'dashboard', { resources: [building('resident-requests', 'Requests'), building('move-bookings', 'Bookings'), building('notices', 'Notices')] }),
  feature('resident', 'my-property', 'My Property', 'Your current property, unit and occupancy relationship.', 'resource', { resources: [building('units', 'Unit'), building('occupancies', 'Occupancy')] }),
  feature('resident', 'issues-requests', 'Issues & Requests', 'Report a location-aware issue and track its progress.', 'resource', { resources: [building('resident-requests', 'Requests')], createFields: residentRequestFields }),
  feature('resident', 'maintenance', 'Maintenance', 'Visible defects and maintenance affecting your permitted property/site context.', 'resource', { resources: [building('defects', 'Defects')] }),
  feature('resident', 'inspections', 'Inspections', 'Inspection appointments and permitted operational inspection information.', 'resource', { resources: [platform('appointment-bookings', 'Inspection bookings', 'site')] }),
  feature('resident', 'bookings', 'Bookings', 'Move and service bookings for your property.', 'resource', { resources: [building('move-bookings', 'Move bookings'), platform('appointment-bookings', 'Service bookings', 'site')], createFields: moveFields }),
  feature('resident', 'access-keys', 'Access & Keys', 'Request and track fobs, remotes, cards and other access devices.', 'resource', { resources: [building('access-device-requests', 'Requests'), building('access-devices', 'Issued devices')], createFields: accessRequestFields }),
  feature('resident', 'documents', 'Documents', 'Resident-visible building and property documents.', 'resource', { resources: [building('documents', 'Documents')] }),
  feature('resident', 'messages', 'Messages', 'Conversations with ProInspect and building management.', 'resource', { resources: [platform('conversations', 'Conversations', 'site')], createFields: conversationFields }),
  feature('resident', 'building-notices', 'Building Notices', 'Current notices for your managed site.', 'resource', { resources: [building('notices', 'Notices')] }),
  feature('resident', 'offers-benefits', 'Offers & Benefits', 'Eligible resident savings, services and partner benefits.', 'resource', { resources: [platform('offers', 'Offers', 'none'), platform('offer-redemptions', 'My redemptions', 'site')] }),
  feature('resident', 'my-household', 'My Household', 'Current occupancy and household relationships.', 'resource', { resources: [building('occupancies', 'Household')] }),
  feature('resident', 'profile', 'Profile', 'Account identity, communication preferences and portal context.', 'profile'),

  // Client
  feature('client', 'dashboard', 'Dashboard', 'Portfolio, services, inspections, maintenance and approvals.', 'client-workspace'),
  feature('client', 'properties', 'Properties', 'Authorised client properties and sites.', 'client-workspace'),
  feature('client', 'service-requests', 'Service Requests', 'Request and track ProInspect services.', 'resource', { resources: [platform('service-requests', 'Service requests', 'client')] }),
  feature('client', 'inspections', 'Inspections', 'Inspection status and booking activity for the client portfolio.', 'client-workspace'),
  feature('client', 'reports', 'Reports', 'Issued reports available to the client.', 'client-workspace'),
  feature('client', 'maintenance', 'Maintenance', 'Maintenance status and work affecting client properties.', 'client-workspace'),
  feature('client', 'quotes-approvals', 'Quotes & Approvals', 'Quote review and approval actions.', 'client-workspace'),
  feature('client', 'documents', 'Documents', 'Client and property documents.', 'client-workspace'),
  feature('client', 'compliance', 'Compliance', 'Portfolio compliance and exception visibility.', 'client-workspace'),
  feature('client', 'contacts-team', 'Contacts & Team', 'Client contacts and authorised team members.', 'client-workspace'),
  feature('client', 'portal-users', 'Portal Users', 'Client portal access and scoped users.', 'client-workspace'),
  feature('client', 'commercial-terms', 'Commercial Terms', 'Approved commercial references and service arrangements.', 'client-workspace'),
  feature('client', 'integrations', 'Integrations', 'Client-facing integration status and references.', 'client-workspace'),
  feature('client', 'messages', 'Messages', 'Client conversations linked to services and properties.', 'resource', { resources: [platform('conversations', 'Conversations', 'client')], createFields: conversationFields }),
  feature('client', 'bookings', 'Bookings', 'Request or reschedule service appointments.', 'resource', { resources: [platform('appointment-bookings', 'Bookings', 'client')], createFields: bookingFields }),

  // Contractor
  feature('contractor', 'home', 'Home', 'Assigned work, attendance, access and compliance requiring attention.', 'dashboard', { resources: [building('operational-work-orders', 'Assigned work'), building('contractor-attendance', 'Attendance'), platform('contractor-compliance', 'Compliance', 'contractor')] }),
  feature('contractor', 'assigned-work', 'Assigned Work', 'Operational work assigned to your contractor company.', 'resource', { resources: [building('operational-work-orders', 'Assigned work')] }),
  feature('contractor', 'schedule', 'Schedule', 'Site events and bookings relevant to assigned work.', 'resource', { resources: [building('calendar-events', 'Schedule')] }),
  feature('contractor', 'site-access', 'Site Access', 'Site instructions, attendance and controlled access information.', 'resource', { resources: [building('property-operating-settings', 'Site instructions'), building('key-register', 'Keys')] }),
  feature('contractor', 'check-in-out', 'Check In / Out', 'Record attendance, site rules, key custody and completion.', 'resource', { resources: [building('contractor-attendance', 'Attendance')] }),
  feature('contractor', 'work-orders', 'Work Orders', 'Assigned operational work orders and current status.', 'resource', { resources: [building('operational-work-orders', 'Work orders')] }),
  feature('contractor', 'quotes', 'Quotes', 'Operational quotes connected to assigned defects/work.', 'resource', { resources: [building('operational-quotes', 'Quotes')] }),
  feature('contractor', 'evidence', 'Evidence', 'Documents and evidence connected to assigned site work.', 'resource', { resources: [building('documents', 'Evidence and documents')] }),
  feature('contractor', 'documents', 'Documents', 'Site rules, work documents and contractor-visible records.', 'resource', { resources: [building('documents', 'Documents')] }),
  feature('contractor', 'compliance', 'Compliance', 'Licences, insurance, expiry state and required evidence.', 'resource', { resources: [platform('contractor-compliance', 'Compliance', 'contractor')] }),
  feature('contractor', 'my-company', 'My Company', 'Contractor company profile and trade information.', 'resource', { resources: [building('contractors', 'Company', 'none')] }),
  feature('contractor', 'notifications', 'Notifications', 'Work, access and compliance notifications.', 'resource', { resources: [building('notifications', 'Notifications', 'none')] }),
];

function normalise(value: string): string {
  return value.toLowerCase().replace(/&/gu, 'and').replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

export function featureForLabel(portalId: PortalId, label: string): PortalFeatureDefinition | undefined {
  return PORTAL_FEATURES.find((item) => item.portalId === portalId && item.label === label)
    ?? PORTAL_FEATURES.find((item) => item.portalId === portalId && item.slug === normalise(label));
}

export function portalFeature(portalId: PortalId, slug: string): PortalFeatureDefinition | undefined {
  return PORTAL_FEATURES.find((item) => item.portalId === portalId && item.slug === slug);
}

export function portalFeatures(portalId: PortalId): readonly PortalFeatureDefinition[] {
  return PORTAL_FEATURES.filter((item) => item.portalId === portalId);
}
