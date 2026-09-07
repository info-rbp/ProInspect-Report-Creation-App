import { replaceOnce } from './patch-lib.mjs';

const intermediateOfflineReceiptTable = `  agencyEntity('offline_sync_receipts', [
    str('userId', 36), str('deviceId', 128), str('clientSubmissionId', 128),
    str('inspectionJobId', 36, true), str('operationId', 128, true), str('operation', 64, true),
    str('entityType', 64), str('entityId', 36), integer('baseVersion', true), integer('resultVersion'),
    str('payloadHash', 128, true), str('resultHash', 128), datetime('receivedAt', true), datetime('appliedAt'),
    text('conflictReason'), str('syncState', 32), integer('attempts'), datetime('firstReceivedAt'),
    datetime('lastAttemptedAt'), datetime('completedAt'), text('conflictDetail'), text('errorDetail'),
  ], [
    unique('operation_once', ['agencyId', 'operationId']), index('job_received', ['inspectionJobId', 'receivedAt']),
    index('operation_received', ['operation', 'receivedAt']), unique('device_submission', ['deviceId', 'clientSubmissionId']),
    index('user_state', ['userId', 'syncState']), index('user_status', ['userId', 'status']),
    index('entity_state', ['entityType', 'entityId', 'syncState']),
  ]),`;

const appwriteCompatibleOfflineReceiptTable = `  agencyEntity('offline_sync_receipts', [
    { ...str('userId', 36), default: null }, { ...str('deviceId', 128), default: null }, { ...str('clientSubmissionId', 128), default: null },
    str('inspectionJobId', 36, true), str('operationId', 128, true), str('operation', 64, true),
    { ...str('entityType', 64), default: null }, str('entityId', 36), integer('baseVersion', true), integer('resultVersion'),
    str('payloadHash', 128, true), str('resultHash', 128), datetime('receivedAt', true), datetime('appliedAt'),
    text('conflictReason'), { ...str('syncState', 32), default: null }, { ...integer('attempts'), default: null }, { ...datetime('firstReceivedAt'), default: null },
    datetime('lastAttemptedAt'), datetime('completedAt'), text('conflictDetail'), text('errorDetail'),
  ], [
    unique('operation_once', ['agencyId', 'operationId']), index('job_received', ['inspectionJobId', 'receivedAt']),
    index('operation_received', ['operation', 'receivedAt']), unique('device_submission', ['deviceId', 'clientSubmissionId']),
    index('user_state', ['userId', 'syncState']), index('user_status', ['userId', 'status']),
    index('entity_state', ['entityType', 'entityId', 'syncState']),
  ]),`;

export async function applyStage07LiveSchemaFix() {
  replaceOnce(
    'infrastructure/appwrite/tables/unified-platform-extensions.mjs',
    intermediateOfflineReceiptTable,
    appwriteCompatibleOfflineReceiptTable,
    'offline receipt Appwrite update defaults',
  );
}
