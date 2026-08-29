import { Query, type Models, type TablesDB } from 'node-appwrite';
import type { ListRowsResult, StoredRow, TablesGateway } from './types.js';

export const APPWRITE_TABLES = {
  agencies: 'agencies',
  managedSites: 'managed_sites',
  properties: 'properties',
  clients: 'clients',
  userProfiles: 'user_profiles',
  agencyMemberships: 'agency_memberships',
  siteMemberships: 'site_memberships',
  serviceRequests: 'service_requests',
  auditEvents: 'audit_events',
  evidenceFiles: 'evidence_files',
} as const;

export class AppwriteTablesGateway implements TablesGateway {
  constructor(private readonly tables: TablesDB, private readonly databaseId = 'proinspect_core') {}

  async createRow<T extends StoredRow>(input: {
    tableId: string; rowId: string; data: Omit<T, '$id'>; permissions?: string[]; transactionId?: string;
  }): Promise<T> {
    return this.tables.createRow({
      databaseId: this.databaseId,
      tableId: input.tableId,
      rowId: input.rowId,
      data: input.data,
      permissions: input.permissions,
      transactionId: input.transactionId,
    }) as unknown as Promise<T>;
  }

  async getRow<T extends StoredRow>(tableId: string, rowId: string): Promise<T> {
    return this.tables.getRow({ databaseId: this.databaseId, tableId, rowId }) as unknown as Promise<T>;
  }

  async updateRow<T extends StoredRow>(input: {
    tableId: string; rowId: string; data: Partial<Omit<T, '$id'>>; permissions?: string[]; transactionId?: string;
  }): Promise<T> {
    return this.tables.updateRow({
      databaseId: this.databaseId,
      tableId: input.tableId,
      rowId: input.rowId,
      data: input.data,
      permissions: input.permissions,
      transactionId: input.transactionId,
    }) as unknown as Promise<T>;
  }

  async listRows<T extends StoredRow>(tableId: string, queries: string[]): Promise<ListRowsResult<T>> {
    const result = await this.tables.listRows({ databaseId: this.databaseId, tableId, queries });
    return { total: result.total, rows: result.rows as unknown as T[] };
  }

  async createTransaction(ttlSeconds = 60): Promise<string> {
    const transaction = await this.tables.createTransaction({ ttl: ttlSeconds });
    return transaction.$id;
  }

  async commitTransaction(transactionId: string): Promise<void> {
    await this.tables.updateTransaction({ transactionId, commit: true });
  }

  async rollbackTransaction(transactionId: string): Promise<void> {
    await this.tables.updateTransaction({ transactionId, rollback: true });
  }
}

export class AgencyScopedRepository<T extends StoredRow> {
  constructor(protected readonly gateway: TablesGateway, protected readonly tableId: string) {}

  async get(agencyId: string, rowId: string): Promise<T> {
    const row = await this.gateway.getRow<T>(this.tableId, rowId);
    if (row.agencyId !== agencyId) throw Object.assign(new Error('Record not found.'), { code: 'NOT_FOUND' });
    return row;
  }

  list(agencyId: string, additionalQueries: string[] = []): Promise<ListRowsResult<T>> {
    return this.gateway.listRows<T>(this.tableId, [Query.equal('agencyId', [agencyId]), ...additionalQueries]);
  }
}

export class AgencyRepository<T extends StoredRow> {
  constructor(private readonly gateway: TablesGateway) {}
  get(rowId: string): Promise<T> { return this.gateway.getRow<T>(APPWRITE_TABLES.agencies, rowId); }
  list(additionalQueries: string[] = []): Promise<ListRowsResult<T>> { return this.gateway.listRows<T>(APPWRITE_TABLES.agencies, additionalQueries); }
}
export class SiteRepository<T extends StoredRow> extends AgencyScopedRepository<T> {
  constructor(gateway: TablesGateway) { super(gateway, APPWRITE_TABLES.managedSites); }
}
export class PropertyRepository<T extends StoredRow> extends AgencyScopedRepository<T> {
  constructor(gateway: TablesGateway) { super(gateway, APPWRITE_TABLES.properties); }
}
export class ClientRepository<T extends StoredRow> extends AgencyScopedRepository<T> {
  constructor(gateway: TablesGateway) { super(gateway, APPWRITE_TABLES.clients); }
}
export class ServiceRequestRepository<T extends StoredRow> extends AgencyScopedRepository<T> {
  constructor(gateway: TablesGateway) { super(gateway, APPWRITE_TABLES.serviceRequests); }
}
export class AuditRepository<T extends StoredRow> extends AgencyScopedRepository<T> {
  constructor(gateway: TablesGateway) { super(gateway, APPWRITE_TABLES.auditEvents); }
}

export type AppwriteRow = Models.Row;
