import { getApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';

interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    status?: number;
    correlationId?: string;
    details?: Record<string, unknown>;
  };
}

let appCheck: AppCheck | undefined;

async function appCheckToken(): Promise<string | undefined> {
  const siteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim();
  if (!siteKey) return undefined;
  if (!appCheck) {
    try {
      appCheck = initializeAppCheck(getApp(), {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch {
      return undefined;
    }
  }
  return (await getToken(appCheck)).token;
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function apiRequest<T>(
  agencyId: string | undefined,
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT'; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is required for cloud operations.');
  let user;
  try {
    user = getAuth().currentUser;
  } catch {
    user = null;
  }
  if (!user) throw new Error('Sign in before accessing cloud records.');
  const tokenResult = await user.getIdTokenResult();
  const claimAgency = typeof tokenResult.claims.agencyId === 'string' ? tokenResult.claims.agencyId : undefined;
  const resolvedAgencyId = agencyId || user.tenantId || claimAgency;
  if (!resolvedAgencyId) throw new Error('The signed-in identity is not linked to an agency.');
  const appCheckValue = await appCheckToken();
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    authorization: `Bearer ${tokenResult.token}`,
    'x-agency-id': resolvedAgencyId,
    accept: 'application/json',
  };
  if (appCheckValue) headers['x-firebase-appcheck'] = appCheckValue;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = init.idempotencyKey ?? newIdempotencyKey();

  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, {
    method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = await response.json() as ApiEnvelope<T> & ApiErrorEnvelope;
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'The API request failed.');
    Object.assign(error, payload.error);
    throw error;
  }
  return payload.data;
}
