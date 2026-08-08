import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies } from '../src/backend/types.js';

let server: ReturnType<typeof createServer> | undefined;
afterEach(() => server?.close());

function dependencies(overrides: Partial<ApiDependencies> = {}): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => ({ uid: 'reviewer-1', agencyId: 'agency-a', role: 'reviewer', authTime: 1, issuedAt: 1, mfaVerified: true }),
      verifyAppCheckToken: async () => undefined,
    },
    memberships: {
      getMembership: async () => ({ uid: 'reviewer-1', agencyId: 'agency-a', role: 'reviewer', status: 'active', mfaRequired: true, updatedAt: new Date().toISOString() }),
    },
    audit: { append: async () => undefined },
    repository: {
      list: async () => ({ items: [] }),
      get: async () => undefined,
      create: async () => { throw new Error('not used'); },
      update: async () => { throw new Error('not used'); },
    },
    reports: {
      load: async () => undefined,
      saveDraft: async () => { throw new Error('not used'); },
      transition: async () => { throw new Error('not used'); },
    },
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async () => ({}) },
    ...overrides,
  };
}

async function post(deps: ApiDependencies, body: unknown) {
  server = createServer(createRequestHandler(deps)).listen(0);
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return fetch(`http://127.0.0.1:${address.port}/v1/security/authorise`, {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('server-authoritative security', () => {
  it('rejects cross-agency access even when the browser supplies the target agency', async () => {
    const response = await post(dependencies(), { capability: 'report.read', target: { agencyId: 'agency-b', reportId: 'r1', assignedReviewerId: 'reviewer-1' } });
    expect(response.status).toBe(403);
  });

  it('rejects privilege escalation from the token when the membership role is lower', async () => {
    const deps = dependencies({ memberships: { getMembership: async () => ({ uid: 'reviewer-1', agencyId: 'agency-a', role: 'inspector', status: 'active', mfaRequired: false, updatedAt: new Date().toISOString() }) } });
    const response = await post(deps, { capability: 'report.review', target: { agencyId: 'agency-a', reportId: 'r1', assignedReviewerId: 'reviewer-1' } });
    expect(response.status).toBe(403);
  });

  it('requires MFA for privileged roles', async () => {
    const deps = dependencies({ identityVerifier: { verifyIdentityToken: async () => ({ uid: 'reviewer-1', agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: false }), verifyAppCheckToken: async () => undefined } });
    const response = await post(deps, { capability: 'report.review', target: { agencyId: 'agency-a', reportId: 'r1', assignedReviewerId: 'reviewer-1' } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'MFA_REQUIRED' } });
  });

  it('allows an assigned reviewer with MFA inside the same agency', async () => {
    const response = await post(dependencies(), { capability: 'report.review', target: { agencyId: 'agency-a', reportId: 'r1', assignedReviewerId: 'reviewer-1' } });
    expect(response.status).toBe(200);
  });
});
