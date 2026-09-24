import { createHash } from 'node:crypto';
import { Query } from 'node-appwrite';
import { createAppwriteServerServices, loadAppwriteServerConfig, type AppwriteServerServices } from './client.js';
import { COLLECTION_TABLES } from './collectionTables.js';
import { workerSchema } from './workerSchema.js';

type Data = Record<string, unknown>;
const fail = (message: string, code = 400): never => { throw Object.assign(new Error(message), { code }); };
const parse = (value: unknown): Data => {
  if (typeof value !== 'string') return {};
  try { const data: unknown = JSON.parse(value); return data && typeof data === 'object' && !Array.isArray(data) ? data as Data : {}; }
  catch { return {}; }
};
export function workerTable(collection: string): string { return COLLECTION_TABLES[collection] ?? fail(`Unmapped canonical collection: ${collection}`); }
export function workerEnvelope(tableId: string): boolean { return workerSchema[tableId]?.some((c) => c.key === 'logicalId') ?? false; }
export function workerRowId(tableId: string, agencyId: string, id: string): string {
  if (!id || /[/\0]/u.test(id)) fail('Invalid record identity');
  return workerEnvelope(tableId) || id.length > 36 ? createHash('sha256').update(`${tableId}\0${agencyId}\0${id}`).digest('hex').slice(0, 36) : id;
}
export function decodeWorkerRow(tableId: string, row: Data): Data {
  const result: Data = { ...(workerEnvelope(tableId) ? parse(row.payload) : {}), ...parse(row.workerState), ...row };
  delete result.workerState;
  if (workerEnvelope(tableId)) { delete result.payload; delete result.logicalId; }
  for (const column of workerSchema[tableId] ?? []) if (column.type === 'longtext' && typeof result[column.key] === 'string' && !['content', 'body', 'commentary', 'notes'].includes(column.key)) {
    try { result[column.key] = JSON.parse(result[column.key] as string); } catch { /* Plain text remains text. */ }
  }
  result.id = row.logicalId ?? row.$id ?? result.id;
  if (tableId === 'inspection_jobs') { result.assignedInspectorId ??= result.inspectorId; result.scheduledAt ??= result.scheduledDate; }
  if (tableId === 'evidence_files') { result.objectPath ??= row.fileId; result.generation ??= row.storageVersion; result.sha256 ??= row.checksum; result.contentType ??= row.mimeType; }
  if (tableId === 'integration_connections') { result.lastSuccessfulSyncAt ??= row.lastSuccessfulAt; result.lastAttemptedSyncAt ??= row.lastAttemptedAt; }
  if (tableId === 'tenant_communications') result.message ??= result.content;
  return result;
}
export function encodeWorkerRow(tableId: string, input: Data, agencyId: string, id: string, actor: string): Data {
  if (input.agencyId !== undefined && input.agencyId !== agencyId) fail('Agency scope mismatch', 403);
  const now = new Date().toISOString();
  const value: Data = { ...input, agencyId, status: input.status ?? 'active', createdAt: input.createdAt ?? now, updatedAt: now, createdBy: input.createdBy ?? actor, updatedBy: actor };
  delete value.id;
  for (const name of Object.keys(value)) if (name.startsWith('$')) delete value[name];
  if (workerEnvelope(tableId)) return { agencyId, logicalId: id, status: value.status, payload: JSON.stringify(value), version: Number(input.version ?? 0) + 1, createdAt: value.createdAt, updatedAt: now, createdBy: value.createdBy, updatedBy: actor };
  if (tableId === 'tenant_communications') value.content ??= value.message;
  if (tableId === 'communications') value.content ??= value.message;
  if (tableId === 'integration_connections') { value.lastSuccessfulAt ??= value.lastSuccessfulSyncAt; value.lastAttemptedAt ??= value.lastAttemptedSyncAt; }
  if (tableId === 'audit_events') { value.action ??= value.eventType; value.actorUserId ??= value.actorId; value.actorType ??= 'system'; value.source ??= 'appwrite_worker'; value.newState ??= value.metadata; value.sourceCreatedAt ??= value.timestamp; for (const alias of ['eventType', 'actorId', 'timestamp', 'metadata']) delete value[alias]; }
  if (tableId === 'integration_outbox') { value.eventType ??= value.kind; value.entityType ??= 'task'; value.entityId ??= id; value.payload ??= '{}'; value.deliveryStatus ??= value.status; value.attempts ??= 0; value.availableAt ??= now; }
  const columns = workerSchema[tableId] ?? fail(`Missing canonical schema: ${tableId}`);
  const known = new Set(columns.map((c) => c.key)); const extra: Data = {};
  for (const [key, item] of Object.entries(value)) if (!known.has(key) && item !== undefined) { extra[key] = item; delete value[key]; }
  if (Object.keys(extra).length) {
    if (!known.has('workerState')) fail(`Unmapped fields for ${tableId}: ${Object.keys(extra).join(',')}`);
    value.workerState = JSON.stringify(extra);
  }
  for (const column of columns) {
    if (column.required && (value[column.key] === undefined || value[column.key] === null)) fail(`Missing ${tableId}.${column.key}`);
    if (column.type === 'longtext' && value[column.key] !== null && typeof value[column.key] === 'object') value[column.key] = JSON.stringify(value[column.key]);
  }
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export class WorkerSnapshot {
  constructor(readonly ref: WorkerReference, private readonly value?: Data) {}
  get exists() { return this.value !== undefined; }
  get id() { return String(this.value?.id ?? this.ref.id); }
  data(): Data { return this.value ?? {}; }
  get(name: string): unknown { return this.value?.[name]; }
}
export class WorkerReference {
  readonly tableId: string; readonly agencyId: string; readonly id: string; readonly rowId: string;
  constructor(readonly db: AppwriteWorkerDatabase, readonly path: string) {
    const parts = path.split('/');
    if (parts.length !== 4 || parts[0] !== 'agencies' || !parts[1] || !parts[3]) fail('Worker references require an agency and canonical entity');
    this.agencyId = parts[1]; this.tableId = workerTable(parts[2]); this.id = parts[3]; this.rowId = workerRowId(this.tableId, this.agencyId, this.id);
  }
  async get(transactionId?: string): Promise<WorkerSnapshot> {
    try {
      const row = await this.db.services.tables.getRow({ databaseId: this.db.services.databaseId, tableId: this.tableId, rowId: this.rowId, transactionId });
      if (row.agencyId !== this.agencyId) fail('Agency scope mismatch', 403);
      return new WorkerSnapshot(this, decodeWorkerRow(this.tableId, row));
    } catch (error) { if (Number((error as { code?: number }).code) === 404) return new WorkerSnapshot(this); throw error; }
  }
  async create(data: Data) { return this.db.runTransaction(async (tx) => { tx.create(this, data); }); }
  async set(data: Data, options: { merge?: boolean } = {}) { return this.db.runTransaction(async (tx) => { tx.set(this, data, options); }); }
  async update(data: Data) { return this.db.runTransaction(async (tx) => { tx.update(this, data); }); }
}
export class WorkerTransaction {
  private writes: Array<() => Promise<unknown>> = [];
  constructor(private db: AppwriteWorkerDatabase, readonly id: string) {}
  get(ref: WorkerReference) { return ref.get(this.id); }
  private write(ref: WorkerReference, data: Data, mode: 'create' | 'update' | 'replace' | 'merge') {
    if (ref.db !== this.db) fail('Transaction database mismatch');
    this.writes.push(async () => {
      const previous = await ref.get(this.id);
      if (ref.tableId === 'audit_events' && previous.exists) fail('Audit is append-only', 409);
      if (mode === 'create' && previous.exists) fail('Record already exists', 409);
      if (mode === 'update' && !previous.exists) fail('Record not found', 404);
      const value = { ...((mode === 'merge' || mode === 'update') && previous.exists ? { ...previous.data(), ...data } : data), createdBy: previous.exists ? previous.get('createdBy') : this.db.actor, updatedBy: this.db.actor };
      if (previous.exists && previous.get('immutable') === true && ref.tableId !== 'reports') fail('Immutable record cannot be modified', 409);
      const input = { databaseId: this.db.services.databaseId, tableId: ref.tableId, rowId: ref.rowId, transactionId: this.id, data: encodeWorkerRow(ref.tableId, value, ref.agencyId, ref.id, this.db.actor) };
      return previous.exists ? this.db.services.tables.updateRow(input) : this.db.services.tables.createRow({ ...input, permissions: [] });
    });
  }
  create(ref: WorkerReference, data: Data) { this.write(ref, data, 'create'); }
  set(ref: WorkerReference, data: Data, options: { merge?: boolean } = {}) { this.write(ref, data, options.merge ? 'merge' : 'replace'); }
  update(ref: WorkerReference, data: Data) { this.write(ref, data, 'update'); }
  async flush() { for (const write of this.writes) await write(); }
}
export class WorkerQuery {
  private filters: Array<[string, string, unknown]> = []; private maximum = 100000;
  constructor(private db: AppwriteWorkerDatabase, readonly path: string) {}
  where(field: string, operator: string, value: unknown) { const next = this.clone(); next.filters.push([field, operator, value]); return next; }
  limit(limit: number) { const next = this.clone(); next.maximum = limit; return next; }
  private clone() { const next = new WorkerQuery(this.db, this.path); next.filters = [...this.filters]; next.maximum = this.maximum; return next; }
  async get() {
    const parts = this.path.split('/'); const global = this.path === 'agencies';
    if (!global && (parts.length !== 3 || parts[0] !== 'agencies' || !parts[1])) fail('Agency-scoped worker query required');
    const tableId = global ? 'agencies' : workerTable(parts[2]); const agencyId = parts[1];
    const queries = global ? [] : [Query.equal('agencyId', [agencyId])];
    const rows: Data[] = []; let cursor: string | undefined;
    for (;;) {
      const page = await this.db.services.tables.listRows({ databaseId: this.db.services.databaseId, tableId, queries: [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
      for (const row of page.rows) { if (!global && row.agencyId !== agencyId) fail('Agency scope mismatch', 403); rows.push(decodeWorkerRow(tableId, row)); }
      if (rows.length > 100000) fail('Worker query exceeds bounded scan; partition the schedule');
      if (page.rows.length < 100) break;
      const next = page.rows.at(-1)!.$id; if (next === cursor) fail('Worker pagination did not advance'); cursor = next;
    }
    const values = rows.filter((row) => this.filters.every(([field, op, expected]) => {
      const value = row[field];
      if (op === '==') return value === expected || (expected === null && value === undefined);
      if (op === 'in') return Array.isArray(expected) && expected.includes(value);
      if (op === 'not-in') return value !== undefined && Array.isArray(expected) && !expected.includes(value);
      if (typeof value !== 'string' || typeof expected !== 'string') return false;
      if (op === '>=') return value >= expected; if (op === '<=') return value <= expected; if (op === '>') return value > expected; if (op === '<') return value < expected;
      return fail('Unsupported worker filter');
    })).slice(0, this.maximum);
    const docs = values.map((value) => new WorkerSnapshot(this.db.doc(`agencies/${global ? value.id : agencyId}/${global ? 'agencies' : parts[2]}/${value.id}`), value));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  count() { return { get: async () => { const result = await this.get(); return { data: () => ({ count: result.size }) }; } }; }
}
export class AppwriteWorkerDatabase {
  constructor(readonly services: AppwriteServerServices, readonly actor: string) {}
  doc(path: string) { return new WorkerReference(this, path); }
  collection(path: string) { return new WorkerQuery(this, path); }
  async runTransaction<T>(operation: (transaction: WorkerTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const tx = await this.services.tables.createTransaction({ ttl: 60 });
      try { const transaction = new WorkerTransaction(this, tx.$id); const result = await operation(transaction); await transaction.flush(); await this.services.tables.updateTransaction({ transactionId: tx.$id, commit: true }); return result; }
      catch (error) { await this.services.tables.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => undefined); if (Number((error as { code?: number }).code) !== 409 || attempt >= 2) throw error; }
    }
  }
}
let singleton: AppwriteWorkerDatabase | undefined;
export function workerDatabase(): AppwriteWorkerDatabase {
  if (process.env.APPWRITE_BACKEND_MODE !== 'appwrite' || process.env.AUTH_PROVIDER !== 'appwrite') fail('Worker requires Appwrite authority');
  singleton ??= new AppwriteWorkerDatabase(createAppwriteServerServices(loadAppwriteServerConfig()), `system:${process.env.K_SERVICE?.replace(/^pcr-/, '').slice(0, 27) || 'worker'}`);
  return singleton;
}
