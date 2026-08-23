import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthenticatedPrincipal, AuthorisationTarget, SecurityCapability, UserRole } from '@pcr/domain';
import { authorise, requiresMfa } from './policy.js';
import { requestSourceIp } from './trustedEdge.js';
import { bearerToken, type SecurityDependencies } from './types.js';

const roles = new Set<UserRole>(['super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer', 'tenant', 'landlord', 'shopify_customer']);

export class SecurityError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export async function authenticateAndAuthorise(
  req: IncomingMessage,
  dependencies: SecurityDependencies,
  capability: SecurityCapability,
  target: AuthorisationTarget,
  correlationId: string,
): Promise<AuthenticatedPrincipal> {
  const token = bearerToken(req);
  if (!token) throw new SecurityError(401, 'AUTH_REQUIRED', 'Authentication is required.');

  if (dependencies.requireAppCheck) {
    const appCheck = req.headers['x-firebase-appcheck']?.toString();
    if (!appCheck) throw new SecurityError(401, 'APP_CHECK_REQUIRED', 'App Check is required.');
    await dependencies.identityVerifier.verifyAppCheckToken(appCheck);
  }

  const identity = await dependencies.identityVerifier.verifyIdentityToken(token);
  const requestedAgencyId = req.headers['x-agency-id']?.toString().trim() || target.agencyId;
  const identityAgencyId = identity.agencyId ?? identity.tenantId;
  const agencyId = requestedAgencyId || identityAgencyId;
  if (!agencyId) throw new SecurityError(403, 'AGENCY_REQUIRED', 'The identity is not linked to an agency or ProInspect provider membership.');

  const membership = await dependencies.memberships.getMembership(identity.uid, agencyId);
  if (!membership || membership.status !== 'active') {
    throw new SecurityError(403, 'MEMBERSHIP_INACTIVE', 'The requested agency membership is not active.');
  }
  if (!roles.has(membership.role)) throw new SecurityError(403, 'ROLE_INVALID', 'The membership role is invalid.');

  const now = dependencies.now?.() ?? new Date();
  if (membership.invitationExpiresAt && new Date(membership.invitationExpiresAt) <= now) {
    throw new SecurityError(403, 'INVITATION_EXPIRED', 'The invitation has expired.');
  }

  const principal: AuthenticatedPrincipal = {
    uid: identity.uid,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.tenantId ? { tenantId: identity.tenantId } : {}),
    agencyId,
    role: membership.role,
    mfaVerified: identity.mfaVerified,
    ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
    tokenIssuedAt: identity.issuedAt,
  };

  if ((membership.mfaRequired || requiresMfa(principal.role)) && !principal.mfaVerified) {
    throw new SecurityError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required.');
  }

  const result = authorise(principal, capability, { ...target, agencyId });
  const sourceIp = requestSourceIp(req);
  const userAgent = req.headers['user-agent'];
  await dependencies.audit.append({
    id: randomUUID(), timestamp: now.toISOString(), actorId: principal.uid, actorRole: principal.role,
    agencyId, capability, outcome: result.allowed ? 'allowed' : 'denied', ...(result.reason ? { reason: result.reason } : {}),
    target: { ...target, agencyId }, correlationId, ...(sourceIp ? { sourceIp } : {}), ...(userAgent ? { userAgent } : {}),
  });

  if (!result.allowed) throw new SecurityError(403, 'FORBIDDEN', 'The requested action is not permitted.');
  return principal;
}
