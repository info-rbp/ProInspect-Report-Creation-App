import { Account, Client } from 'node-appwrite';
import type { IdentityVerifier, VerifiedIdentityToken } from './types.js';

interface JwtPayload {
  iat?: number;
  auth_time?: number;
  sessionId?: string;
  session_id?: string;
}

function jwtPayload(token: string): JwtPayload {
  const encoded = token.split('.')[1];
  if (!encoded) return {};
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return {};
  }
}

export class AppwriteIdentityVerifier implements IdentityVerifier {
  constructor(
    private readonly endpoint = process.env.APPWRITE_ENDPOINT?.trim(),
    private readonly projectId = process.env.APPWRITE_PROJECT_ID?.trim(),
  ) {
    if (!this.endpoint) throw new Error('APPWRITE_ENDPOINT is required for Appwrite identity verification.');
    if (!this.projectId) throw new Error('APPWRITE_PROJECT_ID is required for Appwrite identity verification.');
  }

  async verifyIdentityToken(token: string): Promise<VerifiedIdentityToken> {
    if (!token || token.length < 20) throw Object.assign(new Error('A valid Appwrite JWT is required.'), { status: 401, code: 'AUTH_TOKEN_INVALID' });
    const client = new Client()
      .setEndpoint(this.endpoint as string)
      .setProject(this.projectId as string)
      .setJWT(token);
    const account = new Account(client);
    try {
      const user = await account.get();
      const record = user as unknown as {
        $id: string;
        email?: string;
        mfa?: boolean;
        prefs?: Record<string, unknown>;
      };
      const payload = jwtPayload(token);
      const now = Math.floor(Date.now() / 1000);
      const prefs = record.prefs ?? {};
      return {
        uid: record.$id,
        ...(record.email ? { email: record.email } : {}),
        ...(typeof prefs.agencyId === 'string' ? { agencyId: prefs.agencyId } : {}),
        mfaVerified: record.mfa === true,
        authTime: typeof payload.auth_time === 'number' ? payload.auth_time : typeof payload.iat === 'number' ? payload.iat : now,
        issuedAt: typeof payload.iat === 'number' ? payload.iat : now,
        ...(payload.sessionId || payload.session_id ? { sessionId: payload.sessionId ?? payload.session_id } : {}),
      };
    } catch (error) {
      const status = error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : 401;
      throw Object.assign(new Error('The Appwrite identity token is invalid or expired.'), {
        status: status >= 400 && status < 500 ? 401 : 503,
        code: status >= 400 && status < 500 ? 'AUTH_TOKEN_INVALID' : 'AUTH_PROVIDER_UNAVAILABLE',
      });
    }
  }

  async verifyAppCheckToken(): Promise<void> {
    throw Object.assign(new Error('Firebase App Check is not used for Appwrite identity mode.'), {
      status: 400,
      code: 'APP_CHECK_NOT_APPLICABLE',
    });
  }
}
