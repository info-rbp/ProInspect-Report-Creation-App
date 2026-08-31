import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { tables } from './schema.mjs';
import { foundationReconciliation, RECONCILIATION_STATUSES } from './reconciliation.mjs';
import { unifiedPlatformExtensionTables } from './unified-platform-extensions.mjs';

const allTables = [...tables, ...unifiedPlatformExtensionTables];

describe('Appwrite schema', () => {
  it('keeps every table deny-by-default and query indexes valid', () => {
    for (const table of allTables) {
      expect(table.$permissions).toEqual([]);
      expect(table.rowSecurity).toBe(true);
      const columns = new Set(table.columns.map((column) => column.key));
      for (const index of table.indexes) for (const column of index.columns) expect(columns.has(column), `${table.$id}.${index.key}.${column}`).toBe(true);
    }
  });

  it('keeps generated CLI tables synchronized with source', async () => {
    const generated = JSON.parse(await readFile(new URL('./tables.json', import.meta.url), 'utf8'));
    expect(generated).toEqual(allTables);
  });

  it('defines the indexes required by high-volume operational queries', () => {
    const byId = new Map(allTables.map((table) => [table.$id, table]));
    expect(byId.get('maintenance_items').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['site_status','site_priority_status','property_status','contractor_status']));
    expect(byId.get('inspection_jobs').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['agency_status','inspector_schedule','property_status']));
    expect(byId.get('service_requests').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['agency_status_created','source_reference','property_created']));
  });

  it('reconciles every original foundation table and includes source-backed gaps', () => {
    expect(foundationReconciliation).toHaveLength(67);
    expect(new Set(foundationReconciliation.map((item) => item.table)).size).toBe(67);
    for (const item of foundationReconciliation) expect(RECONCILIATION_STATUSES).toContain(item.status);
    const ids = new Set(allTables.map((item) => item.$id));
    for (const item of foundationReconciliation) expect(ids.has(item.table), item.table).toBe(true);
    for (const required of ['people','tenants','tenancies','tenancy_participants','occupancies','units','contractors','key_register','access_device_requests','defects','operational_inspection_checkpoints','operational_inspection_results','tasks','documents','form_submissions','property_operating_settings']) {
      expect(ids.has(required), required).toBe(true);
    }
  });
});
