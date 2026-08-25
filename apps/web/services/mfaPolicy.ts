import type { UserRole } from '../types/platform';
import type { MfaFlowState } from './mfaService';

const privilegedRoles = new Set<UserRole>(['super_admin', 'proinspect_admin', 'reviewer']);

export interface MfaSessionEvidence {
  verified: boolean;
  enrolledFactors: number;
  emailVerified: boolean;
}

export type MfaSessionDecision = MfaFlowState | 'reauthentication-required';

export function roleRequiresMfa(role: UserRole | undefined): boolean {
  return Boolean(role && privilegedRoles.has(role));
}

export function resolveMfaSessionDecision(
  role: UserRole | undefined,
  session: MfaSessionEvidence,
): MfaSessionDecision {
  if (!roleRequiresMfa(role) || session.verified) return 'none';
  if (!session.emailVerified) return 'email-verification';
  if (session.enrolledFactors === 0) return 'enrollment';
  return 'reauthentication-required';
}
