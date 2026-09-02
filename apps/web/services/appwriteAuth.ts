import {
  beginTotpChallenge,
  beginTotpEnrollment,
  completeEmailVerification,
  completeMfaChallenge,
  completePasswordRecovery,
  createAccountJwt,
  createAppwriteBrowserServices,
  createEmailPasswordSession,
  createMfaRecoveryCodes,
  currentAccount,
  enableMfa,
  logoutCurrentSession,
  requestEmailVerification,
  requestPasswordRecovery,
  verifyTotpEnrollment,
} from '@pcr/appwrite-client';
import type { SecurityRole } from '@pcr/domain';
import type { UserProfile } from '../types/index';

const BOOTSTRAP_ROLES = new Set<SecurityRole>([
  'super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer',
  'tenant', 'landlord', 'shopify_customer', 'building_manager', 'relief_building_manager',
  'strata_manager', 'council_member', 'resident_owner', 'resident_tenant', 'client_admin',
  'client_user', 'contractor_admin', 'contractor_worker',
]);

export type AuthProviderMode = 'firebase' | 'appwrite';

export interface PlatformAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  mfaVerified: boolean;
  provider: AuthProviderMode;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

interface AppwriteUserRecord {
  $id: string;
  email?: string;
  name?: string;
  emailVerification?: boolean;
  mfa?: boolean;
  status?: boolean;
  prefs?: Record<string, unknown>;
}

let services: ReturnType<typeof createAppwriteBrowserServices> | undefined;
let jwtCache: { token: string; expiresAt: number } | undefined;
let pendingChallengeId: string | undefined;

export function configuredAuthProvider(): AuthProviderMode {
  return import.meta.env.VITE_AUTH_PROVIDER?.trim().toLowerCase() === 'appwrite' ? 'appwrite' : 'firebase';
}

function appwriteServices() {
  if (services) return services;
  const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT?.trim();
  const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID?.trim();
  if (!endpoint || !projectId) {
    throw new Error('VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID are required when VITE_AUTH_PROVIDER=appwrite.');
  }
  services = createAppwriteBrowserServices({ endpoint, projectId });
  return services;
}

async function appwriteJwt(forceRefresh = false): Promise<string> {
  if (!forceRefresh && jwtCache && jwtCache.expiresAt > Date.now() + 30_000) return jwtCache.token;
  const result = await createAccountJwt(appwriteServices().account, 900);
  jwtCache = { token: result.jwt, expiresAt: Date.now() + 14 * 60 * 1000 };
  return result.jwt;
}

function toPlatformUser(record: AppwriteUserRecord): PlatformAuthUser {
  return {
    uid: record.$id,
    email: record.email ?? null,
    displayName: record.name ?? null,
    emailVerified: record.emailVerification === true,
    mfaVerified: record.mfa === true,
    provider: 'appwrite',
    getIdToken: appwriteJwt,
  };
}

export function appwriteProfile(record: AppwriteUserRecord): UserProfile {
  const prefs = record.prefs ?? {};
  const preferredRole = typeof prefs.role === 'string' ? prefs.role : '';
  const role = BOOTSTRAP_ROLES.has(preferredRole as SecurityRole)
    ? preferredRole as SecurityRole
    : 'shopify_customer';
  return {
    id: record.$id,
    uid: record.$id,
    email: record.email ?? '',
    displayName: record.name || (typeof prefs.displayName === 'string' ? prefs.displayName : undefined),
    role,
    ...(typeof prefs.agencyId === 'string' ? { agencyId: prefs.agencyId } : {}),
    ...(typeof prefs.providerId === 'string' ? { providerId: prefs.providerId } : {}),
    // Capabilities are resolved by the API from membership and entitlement rows.
    // Never trust mutable account preferences as an authority grant.
    effectiveCapabilities: [],
    status: record.status === false ? 'inactive' : 'active',
    disabled: record.status === false,
  };
}

export function appwriteReturnUrl(path: '/auth/verify-email' | '/auth/reset-password'): string {
  if (typeof window === 'undefined') throw new Error('Appwrite callback URLs require a browser origin.');
  return `${window.location.origin}${path}`;
}

export function isAppwriteMfaChallengeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; type?: unknown };
  return value.type === 'user_more_factors_required'
    || value.type === 'user_more_factors_required_exception'
    || value.code === 'APPWRITE_MFA_REQUIRED';
}

async function createPendingChallenge(): Promise<void> {
  const challenge = await beginTotpChallenge(appwriteServices().account);
  pendingChallengeId = challenge.$id;
}

export async function currentAppwriteAuth(): Promise<{ user: PlatformAuthUser; profile: UserProfile } | null> {
  try {
    const record = await currentAccount(appwriteServices().account) as unknown as AppwriteUserRecord;
    return { user: toPlatformUser(record), profile: appwriteProfile(record) };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : undefined;
    if (code === 401) return null;
    throw error;
  }
}

export async function signInWithAppwrite(email: string, password: string): Promise<{ user: PlatformAuthUser; profile: UserProfile }> {
  try {
    await createEmailPasswordSession(appwriteServices().account, email, password);
  } catch (error) {
    if (!isAppwriteMfaChallengeError(error)) throw error;
    await createPendingChallenge();
    throw Object.assign(new Error('Multi-factor authentication is required.'), { code: 'APPWRITE_MFA_REQUIRED' });
  }
  jwtCache = undefined;
  const current = await currentAppwriteAuth();
  if (!current) throw new Error('Appwrite session was created but the account could not be loaded.');
  return current;
}

export async function signOutFromAppwrite(): Promise<void> {
  await logoutCurrentSession(appwriteServices().account);
  jwtCache = undefined;
  pendingChallengeId = undefined;
}

export async function completeAppwriteMfaSignIn(otp: string): Promise<{ user: PlatformAuthUser; profile: UserProfile }> {
  if (!pendingChallengeId) throw new Error('The Appwrite MFA challenge expired. Sign in again.');
  await completeMfaChallenge(appwriteServices().account, pendingChallengeId, otp.trim());
  pendingChallengeId = undefined;
  jwtCache = undefined;
  const current = await currentAppwriteAuth();
  if (!current) throw new Error('MFA completed but the Appwrite session could not be restored.');
  return current;
}

export async function beginAppwriteTotpEnrollment() {
  const record = await currentAccount(appwriteServices().account) as unknown as AppwriteUserRecord;
  if (record.emailVerification !== true) throw new Error('Verify your email address before enrolling multi-factor authentication.');
  return beginTotpEnrollment(appwriteServices().account);
}

export async function completeAppwriteTotpEnrollment(otp: string): Promise<readonly string[]> {
  await verifyTotpEnrollment(appwriteServices().account, otp.trim());
  await enableMfa(appwriteServices().account);
  const result = await createMfaRecoveryCodes(appwriteServices().account);
  jwtCache = undefined;
  return result.recoveryCodes;
}

export async function sendAppwriteEmailVerification(): Promise<void> {
  await requestEmailVerification(appwriteServices().account, appwriteReturnUrl('/auth/verify-email'));
}

export async function verifyAppwriteEmail(userId: string, secret: string): Promise<void> {
  await completeEmailVerification(appwriteServices().account, userId, secret);
}

export async function sendAppwritePasswordRecovery(email: string): Promise<void> {
  await requestPasswordRecovery(appwriteServices().account, email, appwriteReturnUrl('/auth/reset-password'));
}

export async function resetAppwritePassword(userId: string, secret: string, password: string): Promise<void> {
  await completePasswordRecovery(appwriteServices().account, userId, secret, password);
}
