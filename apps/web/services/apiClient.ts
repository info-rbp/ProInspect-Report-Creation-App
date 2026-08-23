import { getAuth } from 'firebase/auth';
import { getAppCheckToken } from './appCheckService';
import { apiBaseUrl } from './runtimeConfig';

interface ApiEnvelope<T> { data: T; meta?: Record<string, unknown>; }
interface ApiErrorEnvelope { error?: { code?: string; message?: string; status?: number; correlationId?: string; details?: Record<string, unknown>; }; }

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

export async function apiRequest<T>(agencyId: string | undefined, path: string, init: {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; idempotencyKey?: string;
} = {}): Promise<T> {
  const baseUrl = apiBaseUrl();
  let user;
  try { user = getAuth().currentUser; } catch { user = null; }
  if (!user) throw new Error('Sign in before accessing cloud records.');

  const tokenResult = await user.getIdTokenResult();
  const claimAgency = typeof tokenResult.claims.agencyId === 'string' ? tokenResult.claims.agencyId : undefined;
  const storedAgency = typeof window !== 'undefined'
    ? window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined
    : undefined;
  const resolvedAgencyId = agencyId || storedAgency || user.tenantId || claimAgency;
  if (!resolvedAgencyId) throw new Error('The signed-in identity is not linked to an agency.');

  const appCheckValue = await getAppCheckToken();
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    authorization: `Bearer ${tokenResult.token}`,
    'x-agency-id': resolvedAgencyId,
    accept: 'application/json',
  };
  if (appCheckValue) headers['x-firebase-appcheck'] = appCheckValue;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = init.idempotencyKey ?? newIdempotencyKey();

  const execute = async (body: unknown): Promise<{ response: Response; payload: ApiEnvelope<T> & ApiErrorEnvelope }> => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
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
