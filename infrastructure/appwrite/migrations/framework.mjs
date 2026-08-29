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
