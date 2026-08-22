import { randomUUID } from 'node:crypto';
import type { SettingsSection } from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';

function changedFields(before: StoredRecord | undefined, after: StoredRecord): string[] {
  const ignored = new Set(['version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after)]);
  return [...keys].filter((key) => !ignored.has(key) && JSON.stringify(before?.[key]) !== JSON.stringify(after[key])).sort();
}

export async function recordSettingsVersion(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    section: SettingsSection;
    collection: string;
    recordId: string;
    before?: StoredRecord;
    after: StoredRecord;
    actorId: string;
    correlationId: string;
    reason?: string;
  },
): Promise<void> {
  const changedAt = new Date().toISOString();
  const versionId = `${input.collection}-${input.recordId}-v${input.after.version}`;
  const versionExists = await dependencies.repository.get('settingsVersions', input.agencyId, versionId);
  if (!versionExists) {
    await dependencies.repository.create('settingsVersions', input.agencyId, versionId, {
      section: input.section,
      sourceCollection: input.collection,
      sourceRecordId: input.recordId,
      sourceVersion: input.after.version,
      snapshot: Object.fromEntries(Object.entries(input.after).filter(([key]) => !['agencyId', 'createdAt', 'updatedAt'].includes(key))),
      changedBy: input.actorId,
      changedAt,
      correlationId: input.correlationId,
      ...(input.reason ? { reason: input.reason } : {}),
    }, input.actorId);
  }
  await dependencies.repository.create('settingsChangeHistory', input.agencyId, randomUUID(), {
    section: input.section,
    entityId: input.recordId,
    sourceCollection: input.collection,
    versionBefore: input.before?.version,
    versionAfter: input.after.version,
    fieldsChanged: changedFields(input.before, input.after),
    changedBy: input.actorId,
    changedAt,
    correlationId: input.correlationId,
    ...(input.reason ? { reason: input.reason } : {}),
  }, input.actorId);
}
