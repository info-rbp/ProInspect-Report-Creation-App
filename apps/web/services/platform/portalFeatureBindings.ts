import type { PortalId } from '@pcr/domain';
import type { PortalFeatureDefinition, PortalResourceBinding } from './portalFeatureRegistry';

const scoped = (resource: string, label: string, context: PortalResourceBinding['context'] = 'site'): PortalResourceBinding => ({ source: 'scoped', resource, label, context });
const platform = (resource: string, label: string, context: PortalResourceBinding['context'] = 'none'): PortalResourceBinding => ({ source: 'platform', resource, label, context });

const OVERRIDES: Readonly<Record<string, readonly PortalResourceBinding[]>> = {
  // Admin canonical service intake uses an explicit read-only experience route here;
  // creation remains in the governed intake/service router.
  'admin:service-requests': [scoped('admin/service-requests', 'Service requests', 'none')],

  // Building/Strata site directories must never use agency-wide generic lists.
  'building:contractors': [scoped('site/contractors', 'Contractors', 'site'), { source: 'building', resource: 'contractor-attendance', label: 'Attendance', context: 'site' }, platform('contractor-compliance', 'Compliance', 'contractor')],
  'building:residents-units': [scoped('site/residents', 'Residents & units', 'site'), { source: 'building', resource: 'resident-onboarding', label: 'Onboarding', context: 'site' }],
  'strata:contractors': [scoped('site/contractors', 'Contractors', 'site'), { source: 'building', resource: 'contractor-attendance', label: 'Attendance', context: 'site' }, platform('contractor-compliance', 'Compliance', 'contractor')],
  'strata:residents': [scoped('site/residents', 'Residents & units', 'site'), { source: 'building', resource: 'resident-onboarding', label: 'Onboarding', context: 'site' }],
  'strata:users': [scoped('site/users', 'Site users', 'site')],
  'strata:audit': [scoped('site/audit', 'Audit events', 'site')],

  // Resident views are self/occupancy scoped server-side.
  'resident:home': [scoped('resident/requests', 'Requests'), scoped('resident/moves', 'Bookings'), scoped('resident/notices', 'Notices')],
  'resident:my-property': [scoped('resident/my-property', 'Property & occupancy')],
  'resident:issues-requests': [scoped('resident/requests', 'Requests')],
  'resident:maintenance': [scoped('resident/maintenance', 'Maintenance')],
  'resident:inspections': [scoped('resident/inspections', 'Inspections')],
  'resident:bookings': [scoped('resident/moves', 'Move bookings'), platform('appointment-bookings', 'Service bookings', 'site')],
  'resident:access-keys': [scoped('resident/access-requests', 'Access requests'), scoped('resident/access-devices', 'Issued devices')],
  'resident:documents': [scoped('resident/documents', 'Documents')],
  'resident:messages': [scoped('resident/conversations', 'Conversations')],
  'resident:building-notices': [scoped('resident/notices', 'Notices')],
  'resident:my-household': [scoped('resident/household', 'Household')],

  // Contractor views are assignment/company scoped server-side.
  'contractor:home': [scoped('contractor/work', 'Assigned work'), scoped('contractor/attendance', 'Attendance'), scoped('contractor/compliance', 'Compliance')],
  'contractor:assigned-work': [scoped('contractor/work', 'Assigned work')],
  'contractor:work-orders': [scoped('contractor/work', 'Work orders')],
  'contractor:schedule': [scoped('contractor/schedule', 'Schedule')],
  'contractor:site-access': [scoped('contractor/site-access', 'Site access')],
  'contractor:check-in-out': [scoped('contractor/attendance', 'Attendance')],
  'contractor:quotes': [scoped('contractor/quotes', 'Quotes')],
  'contractor:evidence': [scoped('contractor/documents', 'Evidence')],
  'contractor:documents': [scoped('contractor/documents', 'Documents')],
  'contractor:compliance': [scoped('contractor/compliance', 'Compliance')],
  'contractor:my-company': [scoped('contractor/company', 'Company', 'contractor')],
  'contractor:notifications': [scoped('contractor/notifications', 'Notifications')],
};

export function effectivePortalResources(portalId: PortalId, feature: PortalFeatureDefinition): readonly PortalResourceBinding[] {
  return OVERRIDES[`${portalId}:${feature.slug}`] ?? feature.resources ?? [];
}

export function isSelfScopedPortalBinding(portalId: PortalId, featureSlug: string): boolean {
  return (OVERRIDES[`${portalId}:${featureSlug}`] ?? []).some((binding) => binding.source === 'scoped');
}
