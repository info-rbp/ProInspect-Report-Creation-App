import { getAuth } from 'firebase/auth';
import { configuredAuthProvider, currentAppwriteAuth } from './appwriteAuth';
import { getAppCheckToken } from './appCheckService';
import { apiBaseUrl } from './runtimeConfig';

interface ApiEnvelope<T> { data: T; meta?: Record<string, unknown>; }
interface ApiErrorEnvelope { error?: { code?: string; message?: string; status?: number; correlationId?: string; details?: Record<string, unknown>; }; }

const API_TIMEOUT_MS = 15_000;

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function legacyExitFallback(path: string, body: unknown, error: ApiErrorEnvelope['error']): Record<string, unknown> | undefined {
  if (error?.code !== 'ENTRY_BASELINE_REQUIRED') return undefined;
  if (!/^\/api\/v1\/inspection-jobs\/[^/]+\/create-report$/u.test(path)) return undefined;
  if (!isRecord(body) || body.allowLegacyBaseline === true) return undefined;
  return { ...body, allowLegacyBaseline: true };
}

export function storedAgencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

export function resolveRequestAgency(input: {
  requestedAgency?: string;
  claimAgency?: string;
  tenantAgency?: string;
  storedAgency?: string;
  providerSuperAdmin: boolean;
}): string | undefined {
  const requestedAgency = input.requestedAgency?.trim() || undefined;
  const signedAgency = input.claimAgency?.trim() || input.tenantAgency?.trim() || undefined;
  if (input.providerSuperAdmin && requestedAgency) return requestedAgency;
  return signedAgency || requestedAgency || input.storedAgency?.trim() || undefined;
}

function persistAuthoritativeAgency(agencyId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('pcr_agency_id', agencyId);
  window.localStorage.setItem('agencyId', agencyId);
}

export async function apiRequest<T>(agencyId: string | undefined, path: string, init: {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; idempotencyKey?: string;
} = {}): Promise<T> {
  const baseUrl = apiBaseUrl();
  const provider = configuredAuthProvider();
  let token: string;
  let claimAgency: string | undefined;
  let tenantAgency: string | undefined;
  let providerSuperAdmin = false;
  if (provider === 'appwrite') {
    const current = await currentAppwriteAuth();
    if (!current) throw new Error('Sign in before accessing cloud records.');
    token = await current.user.getIdToken(true);
    // Appwrite preferences bootstrap the requested agency only. The API resolves
    // the active agency membership and all scope from server-side TablesDB rows.
    claimAgency = current.profile.agencyId?.trim() || undefined;
  } else {
    let user;
    try { user = getAuth().currentUser; } catch { user = null; }
    if (!user) throw new Error('Sign in before accessing cloud records.');
    // Force-refresh the ID token so newly provisioned agency/provider claims are used
    // immediately after sign-in or an administrator changes a user's access.
    const tokenResult = await user.getIdTokenResult(true);
    token = tokenResult.token;
    claimAgency = typeof tokenResult.claims.agencyId === 'string' ? tokenResult.claims.agencyId.trim() || undefined : undefined;
    tenantAgency = user.tenantId?.trim() || undefined;
    providerSuperAdmin = tokenResult.claims.providerId === 'proinspect'
      && tokenResult.claims.providerRole === 'super_admin';
  }
  const storedAgency = storedAgencyId();

  // Signed identity data is authoritative for ordinary members. Only a provider
  // super administrator, whose provider status is itself signed into the token,
  // may deliberately select a different requested agency. Browser storage never
  // overrides a signed agency claim for an ordinary member.
  const resolvedAgencyId = resolveRequestAgency({
    ...(agencyId ? { requestedAgency: agencyId } : {}),
    ...(claimAgency ? { claimAgency } : {}),
    ...(tenantAgency ? { tenantAgency } : {}),
    ...(storedAgency ? { storedAgency } : {}),
    providerSuperAdmin,
  });
  if (!resolvedAgencyId) throw new Error('The signed-in identity is not linked to an agency.');
  if (!agencyId && (claimAgency || tenantAgency)) persistAuthoritativeAgency(resolvedAgencyId);

  const appCheckValue = provider === 'firebase' ? await getAppCheckToken() : undefined;
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'x-agency-id': resolvedAgencyId,
    accept: 'application/json',
  };
  if (appCheckValue) headers['x-firebase-appcheck'] = appCheckValue;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = init.idempotencyKey ?? newIdempotencyKey();

  const execute = async (body: unknown): Promise<{ response: Response; payload: ApiEnvelope<T> & ApiErrorEnvelope }> => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new Error(`The request to ${path} timed out after ${Math.round(API_TIMEOUT_MS / 1000)} seconds. Retry the operation.`);
        Object.assign(timeoutError, { code: 'REQUEST_TIMEOUT', status: 408 });
        throw timeoutError;
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }

    const rawText = await response.text();
    let payload: (ApiEnvelope<T> & ApiErrorEnvelope) | undefined;
    if (rawText.trim()) {
      try { payload = JSON.parse(rawText) as ApiEnvelope<T> & ApiErrorEnvelope; } catch { payload = undefined; }
    }
    if (!payload) {
      if (response.ok) throw new Error(`API response from ${path} was not valid JSON.`);
      payload = {
        data: undefined as unknown as T,
        error: { code: `HTTP_${response.status}`, status: response.status, message: `Request to ${path} failed (${response.status} ${response.statusText || 'Server Error'}).` },
      };
    }
    return { response, payload };
  };

  let result = await execute(init.body);
  if (!result.response.ok) {
    const fallbackBody = legacyExitFallback(path, init.body, result.payload.error);
    if (fallbackBody) result = await execute(fallbackBody);
  }
  if (!result.response.ok) {
    const error = new Error(result.payload.error?.message ?? 'The API request failed.');
    Object.assign(error, result.payload.error);
    throw error;
  }
  return result.payload.data;
}
