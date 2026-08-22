import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, StoredRecord } from '../src/backend/types.js';

let server: ReturnType<typeof createServer> | undefined;
afterEach(() => server?.close());

function record(id: string, fields: Record<string, unknown> = {}): StoredRecord {
  const now = new Date().toISOString();
  return { id, agencyId: 'agency-a', version: 1, createdAt: now, updatedAt: now, ...fields };
}

function dependencies(role: 'proinspect_admin' | 'inspector' = 'proinspect_admin'): ApiDependencies {
  const collections: Record<string, StoredRecord[]> = {
    properties: [record('property-1', { status: 'active' })],
    inspectionJobs: [record('job-1', { status: 'booked', assignedInspectorId: 'user-1', scheduledAt: new Date().toISOString(), accessStatus: 'unknown' })],
    reports: [record('report-1', { lifecycleStatus: 'review_required', assignedReviewerId: 'reviewer-1' })],
    maintenanceItems: [record('maintenance-1', { status: 'triaged', priority: 'urgent' })],
    tenantInstructions: [record('instruction-1', { status: 'awaiting_action', dueDate: new Date(Date.now() - 86_400_000).toISOString() })],
    tenancies: [record('tenancy-1', { lifecycleStatus: 'vacating', leaseEndDate: new Date(Date.now() + 7 * 86_400_000).toISOString() })],
    tenancyDocuments: [record('document-1', { status: 'signature_required' })],
    clientApprovals: [record('approval-1', { status: 'pending' })],
    maintenanceQuotes: [record('quote-1', { status: 'sent', total: 1250 })],
    maintenanceWorkOrders: [record('work-order-1', { status: 'in_progress' })],
    integrationSyncExceptions: [record('integration-1', { status: 'open', severity: 'critical' })],
    xeroSyncExceptions: [record('xero-1', { status: 'open' })],
    inspectionRequests: [record('request-1', { intakeStatus: 'awaiting_booking' })],
    recurringInspectionSchedules: [record('schedule-1', { paused: false, nextDueAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })],
  };
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => ({ uid: 'user-1', agencyId: 'agency-a', role, authTime: 1, issuedAt: 1, mfaVerified: true }),
      verifyAppCheckToken: async () => undefined,
    },
    memberships: {
      getMembership: async () => ({ uid: 'user-1', agencyId: 'agency-a', role, status: 'active', mfaRequired: role === 'proinspect_admin', updatedAt: new Date().toISOString() }),
    },
    audit: { append: async () => undefined },
    repository: {
      list: async (collection) => ({ items: collections[collection] || [] }),
      get: async () => undefined,
      create: async (_collection, agencyId, id, data) => record(id, { agencyId, ...data }),
      update: async (_collection, agencyId, id, data) => record(id, { agencyId, ...data }),
    },
    reports: {
      load: async () => undefined,
      saveDraft: async () => { throw new Error('not used'); },
      transition: async () => { throw new Error('not used'); },
    },
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async () => ({}) },
  };
}

async function getDashboard(deps: ApiDependencies) {
  server = createServer(createRequestHandler(deps)).listen(0);
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return fetch(`http://127.0.0.1:${address.port}/api/v1/dashboard/overview?range=30d`, {
    headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' },
  });
}

describe('dashboard aggregate', () => {
  it('returns cross-module operational queues for administrators', async () => {
    const response = await getDashboard(dependencies());
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { today: Array<{ key: string; value: number }>; maintenance: Array<{ key: string; value: number }>; commercial?: { xeroExceptions: number } } };
    expect(payload.data.today.find((item) => item.key === 'access_unconfirmed')?.value).toBe(1);
    expect(payload.data.maintenance.find((item) => item.key === 'maintenance_urgent')?.value).toBe(1);
    expect(payload.data.commercial?.xeroExceptions).toBe(1);
  });

  it('limits assigned operational data and hides commercial data for inspectors', async () => {
    const response = await getDashboard(dependencies('inspector'));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { role: string; commercial?: unknown; today: Array<{ key: string; value: number }> } };
    expect(payload.data.role).toBe('inspector');
    expect(payload.data.commercial).toBeUndefined();
    expect(payload.data.today.find((item) => item.key === 'inspections_today')?.value).toBe(1);
  });
});
