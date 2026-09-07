import { replaceOnce, replaceSection, text } from './patch-lib.mjs';
import { appwriteCompatibleOfflineReceiptTable } from './apply-07-live-schema-fix.mjs';

const legacyOfflineReceiptTable = `  agencyEntity('offline_sync_receipts', [
    str('userId', 36, true), str('deviceId', 128, true), str('clientSubmissionId', 128, true),
    str('entityType', 64, true), str('entityId', 36), str('payloadHash', 128, true), str('syncState', 32, true),
    integer('attempts', true), datetime('firstReceivedAt', true), datetime('lastAttemptedAt'), datetime('completedAt'),
    text('conflictDetail'), text('errorDetail'),
  ], [unique('device_submission', ['deviceId', 'clientSubmissionId']), index('user_state', ['userId', 'syncState']), index('user_status', ['userId', 'status']), index('entity_state', ['entityType', 'entityId', 'syncState'])]),`;

const upgradedOfflineReceiptTable = `  agencyEntity('offline_sync_receipts', [
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

const offlineReplay = `async function replayMutation(item: MutationOutboxItem): Promise<number> {
  const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
    ? item.payload as Record<string, unknown>
    : {};
  if (item.operation !== 'job.patch') {
    throw new Error(\`Unsupported offline mutation operation: \${item.operation}\`);
  }
  const updated = await apiRequest<Record<string, unknown>>(
    item.agencyId,
    \`/api/v1/inspection-jobs/\${encodeURIComponent(item.inspectionJobId)}/offline-sync\`,
    {
      method: 'POST',
      body: {
        operationId: item.id,
        operation: item.operation,
        baseVersion: item.expectedVersion,
        patch: payload,
      },
    },
  );
  return Number(updated.version || item.expectedVersion + 1);
}

`;

const routeOffline = `async function routeOffline(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (
    route[0] !== 'api'
    || route[1] !== 'v1'
    || route[2] !== 'inspection-jobs'
    || !route[3]
    || !['offline-package', 'offline-sync', 'sync-status'].includes(route[4] || '')
  ) return undefined;

  const agency = agencyId(req);
  const jobId = route[3];
  const action = route[4];
  const principal = await authorise(
    req,
    deps,
    'job.offline.sync',
    agency,
    correlationId,
    { inspectionJobId: jobId },
  );
  const job = await deps.repository.get('inspectionJobs', agency, jobId);
  if (!job) throw new ApiError(404, 'INSPECTION_JOB_NOT_FOUND', 'Inspection job was not found.');

  if (req.method === 'GET' && action === 'offline-package') {
    const propertyId = String(job.propertyId || (job.propertySnapshot as Record<string, unknown> | undefined)?.propertyId || '');
    const reportId = String(job.reportId || '');
    const layoutId = String(job.propertyLayoutVersionId || (job.propertySnapshot as Record<string, unknown> | undefined)?.propertyLayoutVersionId || '');
    const templateId = String(job.templateVersionId || job.templateId || '');
    const baselineId = String(job.entryBaselineReportId || '');
    const [property, report, tenancy, layout, template, baseline] = await Promise.all([
      propertyId ? deps.repository.get('properties', agency, propertyId) : undefined,
      reportId ? deps.repository.get('reports', agency, reportId) : undefined,
      job.tenancyId ? deps.repository.get('tenancies', agency, String(job.tenancyId)) : undefined,
      layoutId ? deps.repository.get('propertyLayoutVersions', agency, layoutId) : undefined,
      templateId ? deps.repository.get('templates', agency, templateId) : undefined,
      baselineId ? deps.repository.get('reports', agency, baselineId) : undefined,
    ]);
    const data = { job, property, report, tenancy, layout, template, baseline, downloadedAt: new Date().toISOString() };
    return {
      status: 200,
      body: { data: { ...data, packageHash: sha(data) }, meta: { correlationId, actor: principal.uid } },
    };
  }

  if (req.method === 'GET' && action === 'sync-status') {
    const uploads = (await listAll(deps, 'uploadSessions', agency))
      .filter((item) => item.inspectionJobId === jobId);
    const pending = uploads.filter((item) => !['completed', 'duplicate'].includes(String(item.status))).length;
    return {
      status: 200,
      body: {
        data: {
          inspectionJobId: jobId,
          cloudVersion: job.version,
          pendingUploads: pending,
          ready: pending === 0,
        },
        meta: { correlationId },
      },
    };
  }

  if (req.method === 'POST' && action === 'offline-sync') {
    const body = await readJson(req);
    const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
    const operation = typeof body.operation === 'string' ? body.operation.trim() : '';
    const baseVersion = Number(body.baseVersion);
    const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)
      ? body.patch as Record<string, unknown>
      : {};

    if (!operationId || operationId.length > 128) {
      throw new ApiError(400, 'OFFLINE_OPERATION_ID_REQUIRED', 'operationId must be a non-empty string of at most 128 characters.');
    }
    if (operation !== 'job.patch') {
      throw new ApiError(400, 'OFFLINE_OPERATION_UNSUPPORTED', 'Only job.patch is supported for offline mutation replay.');
    }
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new ApiError(400, 'OFFLINE_BASE_VERSION_REQUIRED', 'baseVersion must be a positive integer.');
    }

    const payloadHash = sha({ operation, jobId, baseVersion, patch });
    const receiptId = \`offline_\${createHash('sha256').update(\`${'${agency}'}:\${operationId}\`).digest('hex').slice(0, 28)}\`;
    const existingReceipt = await deps.repository.get('offlineSyncReceipts', agency, receiptId);
    if (existingReceipt) {
      if (
        String(existingReceipt.operationId || '') !== operationId
        || String(existingReceipt.payloadHash || '') !== payloadHash
      ) {
        throw new ApiError(
          409,
          'OFFLINE_OPERATION_REUSE',
          'The offline operation ID was already used with a different payload.',
        );
      }
      return {
        status: 200,
        body: {
          data: {
            ...job,
            version: Number(existingReceipt.resultVersion || job.version),
            offlineOperationId: operationId,
            replayed: true,
          },
          meta: { correlationId, replayed: true, operationId },
        },
      };
    }

    const execution = await deps.idempotency.execute(
      agency,
      'offline.job.patch',
      operationId,
      payloadHash,
      async () => {
        const current = await deps.repository.get('inspectionJobs', agency, jobId);
        if (!current) {
          throw new ApiError(404, 'INSPECTION_JOB_NOT_FOUND', 'Inspection job was not found.');
        }
        if (baseVersion !== Number(current.version)) {
          throw new ApiError(
            409,
            'OFFLINE_CONFLICT',
            'The cloud inspection job changed after the offline package was downloaded.',
            { cloudVersion: current.version, baseVersion },
          );
        }
        const updated = await deps.repository.update(
          'inspectionJobs',
          agency,
          jobId,
          { ...patch, lastOfflineSyncAt: new Date().toISOString() },
          baseVersion,
          principal.uid,
        );
        return {
          status: 200,
          body: {
            data: updated,
            meta: { correlationId, operationId },
          },
        };
      },
    );

    const resultBody = execution.result.body as { data?: Record<string, unknown>; meta?: Record<string, unknown> };
    const resultVersion = Number(resultBody.data?.version || baseVersion + 1);
    const now = new Date().toISOString();
    const receipt = await deps.repository.get('offlineSyncReceipts', agency, receiptId);
    if (!receipt) {
      await deps.repository.create(
        'offlineSyncReceipts',
        agency,
        receiptId,
        {
          inspectionJobId: jobId,
          operationId,
          operation,
          userId: principal.uid,
          entityType: 'inspection_job',
          entityId: jobId,
          baseVersion,
          resultVersion,
          payloadHash,
          resultHash: sha(execution.result.body),
          receivedAt: now,
          appliedAt: now,
        },
        principal.uid,
      );
    }

    return {
      status: execution.result.status,
      body: {
        ...resultBody,
        data: {
          ...(resultBody.data || {}),
          offlineOperationId: operationId,
          replayed: execution.replayed,
        },
        meta: {
          ...(resultBody.meta || {}),
          correlationId,
          operationId,
          replayed: execution.replayed,
        },
      },
    };
  }

  return undefined;
}

`;

export async function applyStage07() {
  // The live compatibility patch is a valid later state of this same migration.
  // Recognize its complete definition, including every column and index.
  if (!text('infrastructure/appwrite/tables/unified-platform-extensions.mjs').includes(appwriteCompatibleOfflineReceiptTable)) {
    replaceOnce(
      'infrastructure/appwrite/tables/unified-platform-extensions.mjs',
      legacyOfflineReceiptTable,
      upgradedOfflineReceiptTable,
      'offline receipt schema migration',
    );
  }
  replaceOnce(
    'infrastructure/appwrite/tables/schema.test.mjs',
    "expect(byId.get('offline_sync_receipts').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['device_submission','user_state','entity_state']));",
    "expect(byId.get('offline_sync_receipts').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['operation_once','job_received','operation_received','device_submission','user_state','entity_state']));",
    'offline receipt index contract',
  );

  replaceSection(
    'apps/web/services/offlineSyncCoordinator.ts',
    'async function replayMutation(',
    'export async function syncOfflineJob(',
    offlineReplay,
    'offline replay operation contract',
  );

  replaceSection(
    'apps/api/src/backend/platformEnhancementRoutes.ts',
    'async function routeOffline(',
    'async function routePlanning(',
    routeOffline,
    'offline server replay and receipt contract',
  );
}
