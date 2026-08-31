import { describe, expect, it } from 'vitest';
import { planMigrationBatch, runMigration } from './framework.mjs';

describe('Appwrite migration framework', () => {
  it('is idempotent when source checksums are unchanged', async () => {
    const mappings = new Map();
    const rows = new Map();
    const target = {
      getMapping: async (system, entity, id) => mappings.get(`${system}:${entity}:${id}`),
      upsert: async (table, id, row) => rows.set(`${table}:${id}`, row),
      upsertMapping: async (mapping) => mappings.set(`${mapping.sourceSystem}:${mapping.sourceEntity}:${mapping.sourceId}`, mapping),
    };
    const input = [{ id: 'legacy-1', agencyId: 'agency-development', name: 'DEV TEST - Property' }];
    const options = { sourceSystem: 'firestore', sourceEntity: 'properties', targetTable: 'properties', migrationVersion: 'v1', records: input, transform: async (row) => row, target, dryRun: false };
    const first = await runMigration(options);
    const second = await runMigration(options);
    expect(first.created).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(rows.size).toBe(1);
  });

  it('does not write during dry runs', async () => {
    let writes = 0;
    const report = await runMigration({
      sourceSystem: 'strata_d1', sourceEntity: 'incidents', targetTable: 'incidents', migrationVersion: 'v1',
      records: [{ id: 'incident-1' }], transform: async (row) => row, dryRun: true,
      target: { getMapping: async () => undefined, upsert: async () => { writes += 1; }, upsertMapping: async () => { writes += 1; } },
    });
    expect(report.created).toBe(1);
    expect(writes).toBe(0);
  });

  it('fails deterministic plans closed for duplicate source identities', () => {
    const plan = planMigrationBatch({
      sourceSystem: 'strata_d1',
      sourceEntity: 'defects',
      targetTable: 'defects',
      agencyId: 'agency-development',
      records: [{ id: 'defect-1' }, { id: 'defect-1' }],
      transform: (record, context) => ({ id: context.targetId, legacyId: record.id }),
    });
    expect(plan.valid).toBe(false);
    expect(plan.targetCount).toBe(1);
    expect(plan.errors).toContainEqual({ code: 'SOURCE_ID_DUPLICATE', sourceId: 'defect-1' });
  });

  it('marks a checksum-matched completed mapping unchanged', () => {
    const source = { id: 'incident-1', category: 'security' };
    const baseline = planMigrationBatch({
      sourceSystem: 'strata_d1',
      sourceEntity: 'incidents',
      targetTable: 'incidents',
      agencyId: 'agency-development',
      records: [source],
      transform: (record, context) => ({ id: context.targetId, category: record.category }),
    });
    const row = baseline.records[0];
    const rerun = planMigrationBatch({
      sourceSystem: 'strata_d1',
      sourceEntity: 'incidents',
      targetTable: 'incidents',
      agencyId: 'agency-development',
      records: [source],
      existingMappings: [{
        sourceSystem: 'strata_d1',
        sourceEntity: 'incidents',
        sourceId: row.sourceId,
        sourceChecksum: row.sourceChecksum,
        migratedChecksum: row.targetChecksum,
        status: 'completed',
      }],
      transform: (record, context) => ({ id: context.targetId, category: record.category }),
    });
    expect(rerun.valid).toBe(true);
    expect(rerun.records[0].action).toBe('unchanged');
  });
});
