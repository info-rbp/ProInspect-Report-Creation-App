import {
  createAccountJwt,
  createAppwriteBrowserServices,
  createEmailPasswordSession,
  currentAccount,
  logoutCurrentSession,
} from '@pcr/appwrite-client';
import type { SecurityRole } from '@pcr/domain';
import type { UserProfile } from '../types/index';
import { asUnifiedRole } from './platform/portalAccess';

export type AuthProviderMode = 'firebase' | 'appwrite';

export interface PlatformAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  provider: AuthProviderMode;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

interface AppwriteUserRecord {
  $id: string;
  email?: string;
  name?: string;
  emailVerification?: boolean;
  mfa?: boolean;
  prefs?: Record<string, unknown>;
}

let services: ReturnType<typeof createAppwriteBrowserServices> | undefined;
let jwtCache: { token: string; expiresAt: number } | undefined;

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
    provider: 'appwrite',
    getIdToken: appwriteJwt,
  };
}

export function appwriteProfile(record: AppwriteUserRecord): UserProfile {
  const prefs = record.prefs ?? {};
  const role = asUnifiedRole(typeof prefs.role === 'string' ? prefs.role : undefined) ?? 'shopify_customer';
  return {
    uid: record.$id,
    email: record.email ?? '',
    displayName: record.name || (typeof prefs.displayName === 'string' ? prefs.displayName : undefined),
    role: role as SecurityRole,
    ...(typeof prefs.agencyId === 'string' ? { agencyId: prefs.agencyId } : {}),
    ...(typeof prefs.providerId === 'string' ? { providerId: prefs.providerId } : {}),
    effectiveCapabilities: Array.isArray(prefs.effectiveCapabilities) ? prefs.effectiveCapabilities.map(String) : [],
    disabled: false,
  };
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
  await createEmailPasswordSession(appwriteServices().account, email, password);
  jwtCache = undefined;
  const current = await currentAppwriteAuth();
  if (!current) throw new Error('Appwrite session was created but the account could not be loaded.');
  return current;
}

export async function signOutFromAppwrite(): Promise<void> {
  await logoutCurrentSession(appwriteServices().account);
  jwtCache = undefined;
}
