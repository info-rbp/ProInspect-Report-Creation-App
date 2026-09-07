import { describe, expect, it, vi } from 'vitest';
import type { AppwriteServerServices } from '@pcr/appwrite-server';
import { AppwritePeopleAdminService } from '../src/backend/appwritePeopleAdmin.js';

function fixture() {
  const created: Array<Record<string, unknown>> = [];

  const users = {
    list: vi.fn(async () => ({ users: [] })),
    create: vi.fn(async ({
      userId,
      email,
      name,
    }: {
      userId: string;
      email?: string;
      name?: string;
    }) => ({
      $id: userId,
      email,
      name,
      status: true,
      emailVerification: false,
    })),
    get: vi.fn(async ({ userId }: { userId: string }) => ({
      $id: userId,
      email: `${userId}@example.com`,
      status: true,
      emailVerification: true,
    })),
    deleteSessions: vi.fn(async () => ({})),
  };

  const tables = {
    listRows: vi.fn(async () => ({ rows: [] })),
    createRow: vi.fn(async ({
      tableId,
      rowId,
      data,
    }: {
      tableId: string;
      rowId: string;
      data: Record<string, unknown>;
    }) => {
      const row = { tableId, $id: rowId, ...data };
      created.push(row);
      return row;
    }),
    updateRow: vi.fn(async ({
      tableId,
      rowId,
      data,
    }: {
      tableId: string;
      rowId: string;
      data: Record<string, unknown>;
    }) => ({ tableId, $id: rowId, ...data })),
    createTransaction: vi.fn(async () => ({ $id: 'transaction-1' })),
    updateTransaction: vi.fn(async () => ({})),
  };

  return {
    created,
    users,
    value: {
      databaseId: 'proinspect_core',
      users,
      tables,
    } as unknown as AppwriteServerServices,
  };
}

describe('Appwrite People administration', () => {
  it('creates an Appwrite user, canonical profile, membership and invitation', async () => {
    const f = fixture();
    const service = new AppwritePeopleAdminService(f.value);

    const result = await service.invite(
      'agency-a',
      {
        email: 'inspector@example.com',
        displayName: 'Test Inspector',
        role: 'inspector',
        mfaRequired: true,
        expiresInDays: 7,
      },
      'admin-a',
    );

    expect(f.users.create).toHaveBeenCalledOnce();
    expect(result.invitation.status).toBe('pending');

    expect(
      f.created.map((row) => row.tableId),
    ).toEqual([
      'user_profiles',
      'agency_memberships',
      'people_invitations',
    ]);
  });

  it('stores workforce data in the canonical Appwrite workforce table', async () => {
    const f = fixture();
    const service = new AppwritePeopleAdminService(f.value);

    const result = await service.saveWorkforceProfile(
      'agency-a',
      'user-a',
      {
        active: true,
        disciplines: ['inspection'],
        inspectionTypes: [],
        propertyUses: [],
        serviceAreas: ['Perth'],
        commercialQualified: false,
        strataQualified: true,
        maxJobsPerDay: 5,
      },
      'admin-a',
    );

    expect(result.maxJobsPerDay).toBe(5);
    expect(
      f.created.find((row) => row.tableId === 'workforce_profiles'),
    ).toMatchObject({
      agencyId: 'agency-a',
      userId: 'user-a',
      active: true,
      version: 1,
    });
  });
});
