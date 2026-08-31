import { createHash } from 'node:crypto';

export const SOURCE_SYSTEMS = ['firebase_auth', 'firestore', 'firebase_storage', 'strata_d1', 'strata_r2'];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function checksum(record) {
  return createHash('sha256').update(JSON.stringify(stable(record))).digest('hex');
}

export function deterministicTargetId(sourceSystem, sourceEntity, sourceId) {
  return createHash('sha256').update(`${sourceSystem}:${sourceEntity}:${sourceId}`).digest('hex').slice(0, 32);
}

/** Stable aliases used by side-effect-free migration planners. */
export const canonicalChecksum = checksum;
export const deterministicId = deterministicTargetId;

/**
 * Build a deterministic dry-run plan without opening a source or target connection.
 * Existing completed mappings are marked unchanged only when both source and target
 * checksums still match; duplicate or missing source identities fail the plan closed.
 */
export function planMigrationBatch({
  sourceSystem,
  sourceEntity,
  targetTable,
  agencyId,
  records,
  existingMappings = [],
  transform,
}) {
  if (!SOURCE_SYSTEMS.includes(sourceSystem)) throw new Error(`Unsupported source system: ${sourceSystem}`);
  if (!Array.isArray(records)) throw new Error('Migration records must be an array.');
  if (typeof transform !== 'function') throw new Error('Migration transform must be a function.');

  const mappingBySourceId = new Map(
    existingMappings
      .filter((mapping) => mapping.sourceSystem === sourceSystem && mapping.sourceEntity === sourceEntity)
      .map((mapping) => [String(mapping.sourceId), mapping]),
  );
  const sourceIds = new Set();
  const plannedRecords = [];
  const errors = [];

  for (const source of records) {
    const sourceId = String(source?.id ?? source?.$id ?? '').trim();
    if (!sourceId) {
      errors.push({ code: 'SOURCE_ID_MISSING' });
      continue;
    }
    if (sourceIds.has(sourceId)) {
      errors.push({ code: 'SOURCE_ID_DUPLICATE', sourceId });
      continue;
    }
    sourceIds.add(sourceId);

    try {
      const sourceChecksum = checksum(source);
      const targetId = deterministicTargetId(sourceSystem, sourceEntity, sourceId);
      const target = transform(source, { targetId, sourceSystem, sourceEntity, agencyId });
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new Error('Transform must return a target object.');
      }
      const targetChecksum = checksum(target);
      const existing = mappingBySourceId.get(sourceId);
      const unchanged = existing?.status === 'completed'
        && existing.sourceChecksum === sourceChecksum
        && existing.migratedChecksum === targetChecksum;
      plannedRecords.push({
        sourceId,
        sourceChecksum,
        targetId,
        targetChecksum,
        target,
        action: unchanged ? 'unchanged' : existing ? 'update' : 'create',
      });
    } catch (error) {
      errors.push({
        code: 'TRANSFORM_FAILED',
        sourceId,
        message: error instanceof Error ? error.message : 'Unknown migration error',
      });
    }
  }

  const targets = plannedRecords.map((record) => record.target);
  return {
    dryRun: true,
    valid: errors.length === 0,
    sourceSystem,
    sourceEntity,
    targetTable,
    agencyId,
    records: plannedRecords,
    sourceCount: records.length,
    targetCount: targets.length,
    sourceChecksum: checksum(records),
    targetChecksum: checksum(targets),
    errors,
  };
}

export async function runMigration({ sourceSystem, sourceEntity, targetTable, migrationVersion, records, transform, target, dryRun = true }) {
  if (!SOURCE_SYSTEMS.includes(sourceSystem)) throw new Error(`Unsupported source system: ${sourceSystem}`);
  const report = { sourceSystem, sourceEntity, targetTable, migrationVersion, dryRun, scanned: 0, created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
  for await (const source of records) {
    report.scanned += 1;
    const sourceId = String(source.id ?? source.$id ?? '');
    if (!sourceId) { report.failed += 1; report.errors.push({ code: 'SOURCE_ID_MISSING' }); continue; }
    try {
      const sourceChecksum = checksum(source);
      const targetId = deterministicTargetId(sourceSystem, sourceEntity, sourceId);
      const existing = await target.getMapping(sourceSystem, sourceEntity, sourceId);
      if (existing?.sourceChecksum === sourceChecksum && existing.status === 'completed') { report.unchanged += 1; continue; }
      const transformed = await transform(source, { targetId, sourceSystem, sourceEntity });
      const migratedChecksum = checksum(transformed);
      if (!dryRun) {
        await target.upsert(targetTable, targetId, transformed);
        await target.upsertMapping({ sourceSystem, sourceEntity, sourceId, targetTable, targetId, sourceChecksum, migratedChecksum, migrationVersion, migratedAt: new Date().toISOString(), status: 'completed' });
      }
      if (existing) report.updated += 1; else report.created += 1;
    } catch (error) {
      report.failed += 1;
      report.errors.push({ sourceId, code: 'TRANSFORM_FAILED', message: error instanceof Error ? error.message : 'Unknown migration error' });
    }
  }
  return report;
}
