import { describe, expect, it } from 'vitest';
import {
  canonicalSerialize,
  checksum,
  deterministicTargetId,
  planMigrationBatch,
  resolveParentTargetId,
  runMigration,
} from './framework.mjs';

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

  it('uses canonical serialization and stable Appwrite IDs', () => {
    expect(canonicalSerialize({ z: 1, nested: { b: 2, a: 1 } })).toBe('{"nested":{"a":1,"b":2},"z":1}');
    expect(checksum({ a: 1, b: 2 })).toBe(checksum({ b: 2, a: 1 }));
    expect(checksum({ a: 1 })).not.toBe(checksum({ a: 2 }));
    expect(deterministicTargetId('strata_d1', 'tasks', 'legacy-1')).toBe(deterministicTargetId('strata_d1', 'tasks', 'legacy-1'));
  });

  it('reprocesses a row when the transformed checksum changes', async () => {
    const mappings = new Map();
    let writes = 0;
    const target = {
      getMapping: async (system, entity, id) => mappings.get(`${system}:${entity}:${id}`),
      upsert: async () => { writes += 1; },
      upsertMapping: async (mapping) => mappings.set(`${mapping.sourceSystem}:${mapping.sourceEntity}:${mapping.sourceId}`, mapping),
    };
    const base = {
      sourceSystem: 'strata_d1', sourceEntity: 'tasks', targetTable: 'tasks', migrationVersion: 'v1',
      records: [{ id: 'task-1', title: 'Inspect door' }], target, dryRun: false,
    };
    await runMigration({ ...base, transform: async (row) => ({ title: row.title, status: 'open' }) });
    const rerun = await runMigration({ ...base, migrationVersion: 'v2', transform: async (row) => ({ title: row.title, status: 'scheduled' }) });
    expect(rerun.updated).toBe(1);
    expect(rerun.unchanged).toBe(0);
    expect(writes).toBe(2);
  });

  it('resumes a partially completed batch and rejects duplicate legacy IDs', async () => {
    const completedSource = { id: 'task-1', title: 'Completed mapping' };
    const completedTarget = { title: completedSource.title };
    const mappings = new Map([['strata_d1:tasks:task-1', {
      sourceSystem: 'strata_d1', sourceEntity: 'tasks', sourceId: 'task-1', status: 'completed',
      sourceChecksum: checksum(completedSource), migratedChecksum: checksum(completedTarget),
    }]]);
    const rows = new Map();
    const target = {
      getMapping: async (system, entity, id) => mappings.get(`${system}:${entity}:${id}`),
      upsert: async (_table, id, row) => rows.set(id, row),
      upsertMapping: async (mapping) => mappings.set(`${mapping.sourceSystem}:${mapping.sourceEntity}:${mapping.sourceId}`, mapping),
    };
    const report = await runMigration({
      sourceSystem: 'strata_d1', sourceEntity: 'tasks', targetTable: 'tasks', migrationVersion: 'v1',
      records: [completedSource, { id: 'task-2', title: 'Resume me' }, { id: 'task-2', title: 'Duplicate' }],
      transform: async (row) => ({ title: row.title }), target, dryRun: false,
    });
    expect(report).toMatchObject({ unchanged: 1, created: 1, failed: 1 });
    expect(report.errors).toContainEqual({ sourceId: 'task-2', code: 'SOURCE_ID_DUPLICATE' });
    expect(rows.size).toBe(1);
  });

  it('returns explicit row exceptions and fails missing parent lookups closed', async () => {
    const report = await runMigration({
      sourceSystem: 'strata_d1', sourceEntity: 'incidents', targetTable: 'incidents', migrationVersion: 'v1',
      records: [{ id: 'incident-1' }], transform: async () => { throw new Error('Unsupported incident category'); }, dryRun: true,
      target: { getMapping: async () => undefined, upsert: async () => undefined, upsertMapping: async () => undefined },
    });
    expect(report.failed).toBe(1);
    expect(report.errors).toContainEqual(expect.objectContaining({ sourceId: 'incident-1', code: 'TRANSFORM_FAILED', message: 'Unsupported incident category' }));
    expect(() => resolveParentTargetId(new Map(), 'firestore', 'clients', 'missing', 'relationship r1')).toThrow(/unplanned firestore\.clients/u);
  });
});
