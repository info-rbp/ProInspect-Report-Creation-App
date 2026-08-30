import type { SecurityRole, WorkforceProfile } from '@pcr/domain';
import { isPrivilegedPeopleRole, mayAssignRole } from '@pcr/domain';

export interface InvitePersonInput {
  email: string;
  displayName?: string;
  role: SecurityRole;
  mfaRequired?: boolean;
  expiresInDays?: number;
}

export interface ChangeRoleInput {
  role: SecurityRole;
  reason: string;
}

export interface MembershipActionInput {
  reason: string;
}

export interface WorkforceProfileInput extends Omit<WorkforceProfile, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
  id?: string;
  expectedVersion?: number;
}

const roles = new Set<SecurityRole>([
  'super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer',
  'tenant', 'landlord', 'shopify_customer', 'building_manager', 'relief_building_manager',
  'strata_manager', 'council_member', 'resident_owner', 'resident_tenant', 'client_admin',
  'client_user', 'contractor_admin', 'contractor_worker',
]);

export function parseInvitePersonInput(value: unknown, actorRole: SecurityRole): InvitePersonInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Request body must be an object.'), { status: 400, code: 'VALIDATION_ERROR' });
  const body = value as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role as SecurityRole;
  if (!/^\S+@\S+\.\S+$/u.test(email)) throw Object.assign(new Error('A valid email address is required.'), { status: 400, code: 'EMAIL_INVALID' });
  if (!roles.has(role)) throw Object.assign(new Error('Unsupported user role.'), { status: 400, code: 'ROLE_INVALID' });
  if (!mayAssignRole(actorRole, role)) throw Object.assign(new Error('You cannot assign this role.'), { status: 403, code: 'ROLE_ASSIGNMENT_FORBIDDEN' });
  const expiresInDays = typeof body.expiresInDays === 'number' ? Math.min(Math.max(Math.round(body.expiresInDays), 1), 30) : 7;
  return {
    email,
    role,
    ...(typeof body.displayName === 'string' && body.displayName.trim() ? { displayName: body.displayName.trim() } : {}),
    mfaRequired: body.mfaRequired === true || isPrivilegedPeopleRole(role),
    expiresInDays,
  };
}

export function parseChangeRoleInput(value: unknown, actorRole: SecurityRole): ChangeRoleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Request body must be an object.'), { status: 400, code: 'VALIDATION_ERROR' });
  const body = value as Record<string, unknown>;
  const role = body.role as SecurityRole;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!roles.has(role)) throw Object.assign(new Error('Unsupported user role.'), { status: 400, code: 'ROLE_INVALID' });
  if (!mayAssignRole(actorRole, role)) throw Object.assign(new Error('You cannot assign this role.'), { status: 403, code: 'ROLE_ASSIGNMENT_FORBIDDEN' });
  if (reason.length < 5) throw Object.assign(new Error('A reason is required for role changes.'), { status: 400, code: 'REASON_REQUIRED' });
  return { role, reason };
}

export function parseMembershipActionInput(value: unknown): MembershipActionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Request body must be an object.'), { status: 400, code: 'VALIDATION_ERROR' });
  const reason = typeof (value as Record<string, unknown>).reason === 'string' ? String((value as Record<string, unknown>).reason).trim() : '';
  if (reason.length < 5) throw Object.assign(new Error('A reason is required.'), { status: 400, code: 'REASON_REQUIRED' });
  return { reason };
}
