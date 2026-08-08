import type { AgencyMembership, AuthenticatedPrincipal, AuthorisationTarget, SecurityCapability } from '@pcr/domain';
import type { IncomingMessage } from 'node:http';

export interface VerifiedIdentityToken {
  uid: string;
  email?: string;
  tenantId?: string;
  agencyId?: string;
  role?: string;
  authTime: number;
  issuedAt: number;
  mfaVerified: boolean;
  sessionId?: string;
}

export interface IdentityVerifier {
  verifyIdentityToken(token: string): Promise<VerifiedIdentityToken>;
  verifyAppCheckToken(token: string): Promise<void>;
}

export interface MembershipRepository {
  getMembership(uid: string, agencyId: string): Promise<AgencyMembership | undefined>;
}

export interface AuditWriter {
  append(event: SecurityAuditEvent): Promise<void>;
}

export interface SecurityAuditEvent {
  id: string;
  timestamp: string;
  actorId: string;
  actorRole: string;
  agencyId: string;
  capability: SecurityCapability | 'authentication';
  outcome: 'allowed' | 'denied';
  reason?: string;
  target?: AuthorisationTarget;
  correlationId: string;
  sourceIp?: string;
  userAgent?: string;
}

export interface SecurityDependencies {
  identityVerifier: IdentityVerifier;
  memberships: MembershipRepository;
  audit: AuditWriter;
  requireAppCheck: boolean;
  now?: () => Date;
}

export interface AuthorisedRequest {
  principal: AuthenticatedPrincipal;
  capability: SecurityCapability;
  target: AuthorisationTarget;
}

export function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}
