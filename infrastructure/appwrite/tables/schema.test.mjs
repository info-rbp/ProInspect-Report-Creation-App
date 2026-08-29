import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { tables } from './schema.mjs';

describe('Appwrite schema', () => {
  it('keeps every table deny-by-default and query indexes valid', () => {
    for (const table of tables) {
      expect(table.$permissions).toEqual([]);
      expect(table.rowSecurity).toBe(true);
      const columns = new Set(table.columns.map((column) => column.key));
      for (const index of table.indexes) for (const column of index.columns) expect(columns.has(column), `${table.$id}.${index.key}.${column}`).toBe(true);
    }
  });

  it('keeps generated CLI tables synchronized with source', async () => {
    const generated = JSON.parse(await readFile(new URL('./tables.json', import.meta.url), 'utf8'));
    expect(generated).toEqual(tables);
  });

  it('defines the indexes required by high-volume operational queries', () => {
    const byId = new Map(tables.map((table) => [table.$id, table]));
    expect(byId.get('maintenance_items').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['site_status','site_priority_status','property_status','contractor_status']));
    expect(byId.get('inspection_jobs').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['agency_status','inspector_schedule','property_status']));
    expect(byId.get('service_requests').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['agency_status_created','source_reference','property_created']));
  });
});
