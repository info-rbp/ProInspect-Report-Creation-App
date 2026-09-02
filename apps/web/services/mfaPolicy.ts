import type { SecurityRole } from '../types/index';
import type { MfaFlowState } from './mfaService';

const privilegedRoles = new Set<SecurityRole>([
  'super_admin', 'proinspect_admin', 'operations', 'inspector', 'reviewer',
  'building_manager', 'relief_building_manager', 'strata_manager', 'council_member',
  'client_admin', 'contractor_admin',
]);

export interface MfaSessionEvidence {
  verified: boolean;
  enrolledFactors: number;
  emailVerified: boolean;
}

export type MfaSessionDecision = MfaFlowState | 'reauthentication-required';

export function roleRequiresMfa(role: SecurityRole | undefined): boolean {
  return Boolean(role && privilegedRoles.has(role));
}

export function resolveMfaSessionDecision(
  role: SecurityRole | undefined,
  session: MfaSessionEvidence,
): MfaSessionDecision {
  if (!roleRequiresMfa(role) || session.verified) return 'none';
  if (!session.emailVerified) return 'email-verification';
  if (session.enrolledFactors === 0) return 'enrollment';
  return 'reauthentication-required';
}
