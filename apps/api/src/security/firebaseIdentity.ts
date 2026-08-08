import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import type { IdentityVerifier, VerifiedIdentityToken } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirebaseIdentityVerifier implements IdentityVerifier {
  async verifyIdentityToken(token: string): Promise<VerifiedIdentityToken> {
    const decoded = await getAuth(adminApp()).verifyIdToken(token, true);
    const firebase = decoded.firebase as { tenant?: string; sign_in_second_factor?: string } | undefined;
    return {
      uid: decoded.uid,
      ...(decoded.email ? { email: decoded.email } : {}),
      ...(firebase?.tenant ? { tenantId: firebase.tenant } : {}),
      ...(typeof decoded.agencyId === 'string' ? { agencyId: decoded.agencyId } : {}),
      ...(typeof decoded.role === 'string' ? { role: decoded.role } : {}),
      authTime: decoded.auth_time,
      issuedAt: decoded.iat,
      mfaVerified: Boolean(firebase?.sign_in_second_factor || decoded.mfa_verified === true),
      ...(typeof decoded.sessionId === 'string' ? { sessionId: decoded.sessionId } : {}),
    };
  }

  async verifyAppCheckToken(token: string): Promise<void> {
    await getAppCheck(adminApp()).verifyToken(token);
  }
}
