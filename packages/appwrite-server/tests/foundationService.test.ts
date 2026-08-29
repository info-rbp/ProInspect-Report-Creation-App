import { describe, expect, it } from 'vitest';
import { AppwriteFoundationService } from '../src/foundationService.js';
import type { ListRowsResult, StoredRow, TablesGateway } from '../src/types.js';

class MemoryGateway implements TablesGateway {
  readonly rows = new Map<string, StoredRow>();
  commits = 0;
  rollbacks = 0;
  async createRow<T extends StoredRow>(input: { tableId: string; rowId: string; data: Omit<T, '$id'> }): Promise<T> {
    const key = `${input.tableId}:${input.rowId}`;
    if (this.rows.has(key)) throw new Error('duplicate');
    const row = { $id: input.rowId, ...input.data } as T;
    this.rows.set(key, row);
    return row;
  }
  async getRow<T extends StoredRow>(tableId: string, rowId: string): Promise<T> { return this.rows.get(`${tableId}:${rowId}`) as T; }
  async updateRow<T extends StoredRow>(): Promise<T> { throw new Error('not implemented'); }
  async listRows<T extends StoredRow>(): Promise<ListRowsResult<T>> { return { total: 0, rows: [] }; }
  async createTransaction(): Promise<string> { return 'transaction-1'; }
  async commitTransaction(): Promise<void> { this.commits += 1; }
  async rollbackTransaction(): Promise<void> { this.rollbacks += 1; }
}

describe('Appwrite foundation service', () => {
  it('creates a service request and audit event in one transaction boundary', async () => {
    const gateway = new MemoryGateway();
    const service = new AppwriteFoundationService(gateway, () => new Date('2026-08-29T00:00:00.000Z'));
    const request = await service.createServiceRequest({
      agencyId: 'agency-development', serviceDefinitionId: 'routine-inspection', source: 'admin_portal',
      sourceReference: 'DEV-REQUEST-1', requestedByUserId: 'development-admin', correlationId: 'correlation-1',
      readScope: { userIds: ['development-admin'] },
    });
    expect(request.status).toBe('received');
    expect([...gateway.rows.keys()].filter((key) => key.startsWith('audit_events:'))).toHaveLength(1);
    expect(gateway.commits).toBe(1);
    expect(gateway.rollbacks).toBe(0);
  });
});
