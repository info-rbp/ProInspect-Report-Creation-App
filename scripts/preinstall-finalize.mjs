import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, value) { writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`); }
function replaceOnce(path, before, after) {
  const source = read(path);
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Expected source fragment not found in ${path}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Source fragment is not unique in ${path}: ${before.slice(0, 120)}`);
  write(path, source.slice(0, first) + after + source.slice(first + before.length));
}
function replaceBetween(path, startMarker, endMarker, replacement) {
  const source = read(path);
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Start marker not found in ${path}: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`End marker not found in ${path}: ${endMarker}`);
  write(path, source.slice(0, start) + replacement + source.slice(end));
}

write('apps/api/tests/stage4RuntimeParity.test.ts', `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Stage 4 runtime parity boundary', () => {
  it('maps clientApprovals to a dedicated canonical Appwrite table', () => {
    const adapters = read('src/backend/appwriteAdapters.ts');
    expect(adapters).toContain("clientApprovals: 'client_approvals'");
    expect(adapters).toContain('collectionWriteData');
    expect(adapters).toContain('collectionReadRecord');
  });

  it('routes tenant automation grant issuance through the API provider', () => {
    const portal = read('src/backend/tenantPortalRoutes.ts');
    expect(portal).toContain("parts[2] === 'internal'");
    expect(portal).toContain("parts[3] === 'tenant-portal-grants'");
    expect(portal).toContain("parts[4] === 'automation'");
    expect(portal).toContain("req.method === 'POST'");
    expect(portal).toContain('return automationGrant(req, dependencies, correlationId)');
    expect(portal).toContain('automationGrant');
    expect(portal).toContain('requireExternalGrantStore');

    const implementation = read('../notification-worker/src/index.ts');
    expect(implementation).toContain('PROINSPECT_API_BASE_URL');
    expect(implementation).toContain('/api/v1/internal/tenant-portal-grants/automation');
    expect(implementation).toContain('x-proinspect-automation-secret');
    expect(implementation).not.toContain('tenantPortalGrants');

    const runtime = read('../notification-worker/src/runtime.ts');
    expect(runtime).toContain("from './index.js'");
    expect(runtime).not.toContain('firebase-admin');
    expect(runtime).not.toContain('tenantPortalGrants');
  });
});
`);

write('infrastructure/appwrite/tables/worker-extensions.mjs', `const str = (key, size = 255, required = false) => ({ key, type: 'string', size, required });
const text = (key, required = false) => ({ key, type: 'longtext', required });
const datetime = (key, required = false) => ({ key, type: 'datetime', required });
const integer = (key, required = false) => ({ key, type: 'integer', required });
const boolean = (key, required = false) => ({ key, type: 'boolean', required });
const index = (key, columns, orders) => ({ key, type: 'key', columns, ...(orders ? { orders } : {}) });
const unique = (key, columns) => ({ key, type: 'unique', columns });
const timestamps = [datetime('createdAt', true), datetime('updatedAt', true)];
const auditActors = [str('createdBy', 36), str('updatedBy', 36)];
const legacy = [str('legacySystem', 32), str('legacyId', 128)];
const agencyBase = [str('agencyId', 36, true), str('status', 64, true), ...timestamps, ...auditActors, ...legacy];
function table(id, columns, indexes = []) {
  return { $id: id, databaseId: 'proinspect_core', name: id.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '), $permissions: [], rowSecurity: true, enabled: true, columns: [...new Map(columns.map((column) => [column.key, column])).values()], indexes };
}
function agencyEntity(id, columns = [], indexes = []) {
  return table(id, [...agencyBase, ...columns], [index('agency_status', ['agencyId', 'status']), ...indexes]);
}

export const workerExtensionTables = [
  table('document_template_versions', [
    str('agencyId', 36), str('templateKey', 128, true), integer('version', true), str('purpose', 64, true),
    str('sourceBucketId', 36, true), str('sourceFileId', 36, true), str('sourceSha256', 64, true),
    text('fieldSchema', true), datetime('publishedAt', true), boolean('immutable', true), str('status', 64, true),
    ...timestamps, ...auditActors, ...legacy,
  ], [unique('template_version', ['agencyId', 'templateKey', 'version']), index('agency_status', ['agencyId', 'status']), index('status_published', ['status', 'publishedAt'])]),
  agencyEntity('dashboard_metric_snapshots', [
    datetime('capturedAt', true), str('timezone', 64, true), str('source', 128, true), text('metrics', true), integer('version', true),
  ], [index('agency_captured', ['agencyId', 'capturedAt'], ['ASC', 'DESC'])]),
  agencyEntity('pdf_jobs', [
    str('taskId', 36, true), str('reportId', 36, true), str('reportVersionId', 36), str('currentVersionId', 36),
    str('priority', 16), str('requestedBy', 36), datetime('queuedAt'), str('renderId', 64), str('canonicalInputHash', 64),
    str('pdfFileId', 36), str('pdfSha256', 64), str('manifestId', 36), str('manifestSha256', 64),
    str('errorCode', 128), text('errorMessage'), boolean('retryable'), datetime('startedAt'), datetime('completedAt'), datetime('failedAt'),
  ], [unique('agency_task', ['agencyId', 'taskId']), index('report_status', ['reportId', 'status']), index('version_status', ['reportVersionId', 'status'])]),
  agencyEntity('report_render_manifests', [
    str('reportId', 36, true), str('reportVersionId', 36, true), str('renderId', 64, true), str('canonicalInputHash', 64, true),
    str('pdfFileId', 36, true), str('pdfSha256', 64, true), text('manifest', true), str('manifestSha256', 64, true),
    datetime('generatedAt', true), str('generatedBy', 36, true), boolean('immutable', true),
  ], [unique('report_version_render', ['reportId', 'reportVersionId', 'renderId']), index('version_generated', ['reportVersionId', 'generatedAt'])]),
  agencyEntity('report_presentation_template_versions', [
    integer('version', true), text('payload', true), boolean('immutable', true), datetime('publishedAt'), datetime('retiredAt'),
  ], [index('status_published', ['status', 'publishedAt'])]),
  agencyEntity('report_branding_profile_versions', [
    integer('version', true), text('payload', true), boolean('immutable', true), datetime('publishedAt'), datetime('retiredAt'),
  ], [index('status_published', ['status', 'publishedAt'])]),
  agencyEntity('report_presentation_pins', [
    str('reportId', 36, true), str('reportVersionId', 36, true), str('presentationTemplateRecordId', 36, true),
    str('presentationTemplateId', 128, true), integer('presentationTemplateVersion', true), text('presentationTemplateSnapshot', true),
    str('brandingProfileRecordId', 36, true), str('brandingProfileId', 128, true), integer('brandingProfileVersion', true),
    text('brandingSnapshot', true), str('brandingSnapshotHash', 64, true), str('rendererVersion', 128, true),
    str('fontBundleVersion', 128, true), datetime('capturedAt', true), boolean('immutable', true),
  ], [unique('agency_report_version', ['agencyId', 'reportVersionId']), index('report_version', ['reportId', 'reportVersionId'])]),
];
`);

write('infrastructure/appwrite/tables/schema.test.mjs', `import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { tables } from './schema.mjs';
import { unifiedPlatformExtensionTables } from './unified-platform-extensions.mjs';
import { workerExtensionTables } from './worker-extensions.mjs';
import { foundationReconciliation, RECONCILIATION_STATUSES } from './reconciliation.mjs';

const allTables = [...tables, ...unifiedPlatformExtensionTables, ...workerExtensionTables];

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
    expect(byId.get('portal_entitlements').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['user_status','user_portal','site_portal','client_portal']));
    expect(byId.get('conversation_messages').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['conversation_sent','delivery_status']));
    expect(byId.get('appointment_bookings').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['request_state','assignee_start','property_start']));
    expect(byId.get('offline_sync_receipts').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['operation_once','job_received','operation_received','device_submission','user_state','entity_state']));
    expect(byId.get('dashboard_metric_snapshots').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['agency_status','agency_captured']));
    expect(byId.get('report_presentation_pins').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['agency_status','agency_report_version','report_version']));
  });

  it('reconciles every original foundation table and includes source-backed and unified-platform gaps', () => {
    expect(foundationReconciliation).toHaveLength(67);
    expect(new Set(foundationReconciliation.map((item) => item.table)).size).toBe(67);
    for (const item of foundationReconciliation) expect(RECONCILIATION_STATUSES).toContain(item.status);
    const ids = new Set(allTables.map((item) => item.$id));
    for (const item of foundationReconciliation) expect(ids.has(item.table), item.table).toBe(true);
    for (const required of ['people','tenants','tenancies','tenancy_participants','occupancies','units','contractors','key_register','access_device_requests','defects','operational_inspection_checkpoints','operational_inspection_results','tasks','documents','form_submissions','property_operating_settings','portal_entitlements','contractor_compliance','offer_partners','offers','offer_redemptions','conversations','conversation_participants','conversation_messages','notification_preferences','appointment_availability','appointment_bookings','route_plans','route_plan_stops','offline_sync_receipts','people_invitations','workforce_profiles','external_access_grants','client_approvals','dashboard_metric_snapshots','document_template_versions','pdf_jobs','report_render_manifests','report_presentation_template_versions','report_branding_profile_versions','report_presentation_pins']) {
      expect(ids.has(required), required).toBe(true);
    }
    expect(allTables).toHaveLength(127);
  });
});
`);

replaceOnce('infrastructure/upgrades/launch-readiness-v2/manifest.json', '"targetSchemaTables": 124', '"targetSchemaTables": 127');
const manifest = read('infrastructure/upgrades/launch-readiness-v2/manifest.json');
const integrityPath = 'infrastructure/upgrades/launch-readiness-v2/integrity.json';
const integrity = JSON.parse(read(integrityPath));
integrity.files['manifest.json'] = createHash('sha256').update(manifest).digest('hex');
write(integrityPath, JSON.stringify(integrity, null, 2));

replaceOnce(
  'apps/api/src/backend/appwriteAdapters.ts',
  "  observations: 'observations', inspectionEvidence: 'inspection_evidence', reports: 'reports', reportVersions: 'report_versions',",
  "  observations: 'observations', inspectionEvidence: 'inspection_evidence', reports: 'reports', reportVersions: 'report_versions',\n  dashboardMetricSnapshots: 'dashboard_metric_snapshots', pdfJobs: 'pdf_jobs',\n  reportPresentationTemplateVersions: 'report_presentation_template_versions', reportBrandingProfileVersions: 'report_branding_profile_versions',",
);
replaceOnce(
  'apps/api/src/backend/appwriteAdapters.ts',
  "  'maintenance_items', 'maintenance_work_orders', 'operational_report_drafts', 'documents', 'tenancy_documents',",
  "  'maintenance_items', 'maintenance_work_orders', 'operational_report_drafts', 'documents', 'tenancy_documents',\n  'dashboard_metric_snapshots', 'report_presentation_template_versions', 'report_branding_profile_versions',",
);
replaceOnce(
  'apps/api/src/backend/appwriteAdapters.ts',
  "function collectionWriteData(\n  collection: string,\n  input: Record<string, unknown>,\n): Record<string, unknown> {\n  const mapped = appwriteCollectionWriteData(collection, input);",
  "function collectionWriteData(\n  collection: string,\n  input: Record<string, unknown>,\n  existing?: StoredRecord,\n): Record<string, unknown> {\n  const mapped = appwriteCollectionWriteData(collection, input, existing);",
);
replaceOnce(
  'apps/api/src/backend/appwriteAdapters.ts',
  "data: writeData(collectionWriteData(collection, { ...data, agencyId }), actorId), permissions: [],",
  "data: writeData(collectionWriteData(collection, { ...data, agencyId, id }), actorId), permissions: [],",
);
replaceOnce(
  'apps/api/src/backend/appwriteAdapters.ts',
  "const patch = writeData(collectionWriteData(collection, data), actorId, current);",
  "const patch = writeData(collectionWriteData(collection, data, current), actorId, current);",
);

write('apps/api/src/backend/appwriteCollectionTransforms.ts', `import type { StoredRecord } from './types.js';

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}
function definedEntries(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
function pick(source: Record<string, unknown> | undefined, fields: readonly string[]): Record<string, unknown> {
  if (!source) return {};
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

function integrationConnectionWrite(input: Record<string, unknown>): Record<string, unknown> {
  const { externalAccountLabel, permissions, configuration, lastSuccessfulSyncAt, lastAttemptedSyncAt, lastErrorCode, lastErrorMessage, syncRequestedAt, ...rest } = input;
  const configurationProvided = configuration !== undefined || externalAccountLabel !== undefined || permissions !== undefined || syncRequestedAt !== undefined;
  const metadata = configurationProvided ? { ...(configuration && typeof configuration === 'object' && !Array.isArray(configuration) ? configuration as Record<string, unknown> : {}), ...(externalAccountLabel !== undefined ? { __externalAccountLabel: externalAccountLabel } : {}), ...(permissions !== undefined ? { __permissions: permissions } : {}), ...(syncRequestedAt !== undefined ? { __syncRequestedAt: syncRequestedAt } : {}) } : undefined;
  const errorProvided = lastErrorCode !== undefined || lastErrorMessage !== undefined;
  return definedEntries({ ...rest, ...(configurationProvided ? { configuration: JSON.stringify(metadata) } : {}), ...(lastSuccessfulSyncAt !== undefined ? { lastSuccessfulAt: lastSuccessfulSyncAt } : {}), ...(lastAttemptedSyncAt !== undefined || syncRequestedAt !== undefined ? { lastAttemptedAt: lastAttemptedSyncAt ?? syncRequestedAt } : {}), ...(errorProvided ? { lastError: lastErrorCode === null && lastErrorMessage === null ? null : JSON.stringify({ code: lastErrorCode, message: lastErrorMessage }) } : {}) });
}
function integrationConnectionRead(value: StoredRecord): StoredRecord {
  const metadata = parseObject(value.configuration); const error = parseObject(value.lastError); const { __externalAccountLabel, __permissions, __syncRequestedAt, ...configuration } = metadata;
  return { ...value, configuration, ...(__externalAccountLabel !== undefined ? { externalAccountLabel: __externalAccountLabel } : {}), permissions: Array.isArray(__permissions) ? __permissions : [], ...(value.lastSuccessfulAt ? { lastSuccessfulSyncAt: value.lastSuccessfulAt } : {}), ...(value.lastAttemptedAt ? { lastAttemptedSyncAt: value.lastAttemptedAt } : {}), ...(__syncRequestedAt ? { syncRequestedAt: __syncRequestedAt } : {}), ...(error.code !== undefined ? { lastErrorCode: error.code } : {}), ...(error.message !== undefined ? { lastErrorMessage: error.message } : {}) };
}
function inspectionRequestWrite(input: Record<string, unknown>): Record<string, unknown> {
  const { sourceExternalId, bookingStatus, reportType, shopifyOrder, googleCalendar, ...rest } = input;
  const allowed = new Set(['serviceRequestId','propertyId','inspectionType','source','sourceReference','paymentStatus','schedulingStatus','priority','shopifyReference','calendarReference','status','createdAt','updatedAt','createdBy','updatedBy','legacySystem','legacyId']);
  const compact = Object.fromEntries(Object.entries(rest).filter(([key]) => allowed.has(key)));
  const domainSnapshot = definedEntries({ ...input, shopifyOrder, googleCalendar });
  return definedEntries({ ...compact, sourceReference: sourceExternalId ?? input.sourceReference, schedulingStatus: bookingStatus ?? input.schedulingStatus, inspectionType: reportType ?? input.inspectionType, ...(shopifyOrder || input.source === 'shopify' ? { shopifyReference: JSON.stringify(domainSnapshot) } : {}), ...(googleCalendar || input.source === 'google_calendar' ? { calendarReference: JSON.stringify(domainSnapshot) } : {}) });
}
function inspectionRequestRead(value: StoredRecord): StoredRecord {
  const snapshot = value.source === 'shopify' ? parseObject(value.shopifyReference) : value.source === 'google_calendar' ? parseObject(value.calendarReference) : {};
  return { ...value, ...snapshot, sourceExternalId: snapshot.sourceExternalId ?? value.sourceReference, bookingStatus: snapshot.bookingStatus ?? value.schedulingStatus, reportType: snapshot.reportType ?? value.inspectionType };
}
function integrationDeliveryWrite(input: Record<string, unknown>): Record<string, unknown> {
  const metadata = definedEntries({ topic: input.topic, payloadHash: input.payloadHash, inspectionRequestId: input.inspectionRequestId, inspectionJobId: input.inspectionJobId, errorCode: input.errorCode, errorMessage: input.errorMessage, receivedAt: input.receivedAt, processedAt: input.processedAt });
  const status = input.status ?? input.deliveryStatus; const attemptedAt = input.processedAt ?? input.receivedAt ?? input.lastAttemptedAt;
  return definedEntries({ provider: input.provider, eventId: input.externalEventId ?? input.eventId, externalDeliveryId: input.externalDeliveryId, deliveryStatus: status, attempts: input.attempts ?? 1, lastAttemptedAt: attemptedAt, deliveredAt: ['processed','ignored','duplicate'].includes(String(status)) ? input.processedAt ?? attemptedAt : input.deliveredAt, errorState: JSON.stringify(metadata), status: input.status === 'active' ? 'active' : undefined, createdAt: input.createdAt, updatedAt: input.updatedAt, createdBy: input.createdBy, updatedBy: input.updatedBy });
}
function integrationDeliveryRead(value: StoredRecord): StoredRecord {
  const metadata = parseObject(value.errorState); return { ...value, ...metadata, externalEventId: metadata.externalEventId ?? value.eventId, status: value.deliveryStatus ?? value.status, processedAt: metadata.processedAt ?? value.deliveredAt, receivedAt: metadata.receivedAt ?? value.createdAt };
}
function serviceMappingWrite(input: Record<string, unknown>): Record<string, unknown> {
  const config = definedEntries({ provider: input.provider ?? 'shopify', serviceCode: input.serviceCode, label: input.label, productId: input.productId, variantId: input.variantId, productHandle: input.productHandle, sku: input.sku, reportType: input.reportType, propertyUse: input.propertyUse, defaultDurationMinutes: input.defaultDurationMinutes, paymentRequired: input.paymentRequired, manualApprovalRequired: input.manualApprovalRequired, defaultPriority: input.defaultPriority, defaultInspectorId: input.defaultInspectorId, defaultReviewerId: input.defaultReviewerId, templateId: input.templateId });
  return definedEntries({ shopDomain: input.shopDomain, shopifyProductId: input.shopifyProductId ?? input.productId, shopifyVariantId: input.shopifyVariantId ?? input.variantId, serviceDefinitionId: input.serviceDefinitionId, active: input.active, mappingConfiguration: JSON.stringify(config), status: input.status, createdAt: input.createdAt, updatedAt: input.updatedAt, createdBy: input.createdBy, updatedBy: input.updatedBy });
}
function serviceMappingRead(value: StoredRecord): StoredRecord {
  const config = parseObject(value.mappingConfiguration); return { ...value, ...config, provider: config.provider ?? 'shopify', productId: config.productId ?? value.shopifyProductId, variantId: config.variantId ?? value.shopifyVariantId };
}
function dashboardSnapshotWrite(input: Record<string, unknown>, existing?: StoredRecord): Record<string, unknown> {
  const metrics = input.metrics ?? existing?.metrics ?? {};
  return definedEntries({ agencyId: input.agencyId, status: input.status ?? existing?.status ?? 'active', capturedAt: input.capturedAt ?? existing?.capturedAt, timezone: input.timezone ?? existing?.timezone ?? 'Australia/Perth', source: input.source ?? existing?.source ?? 'api-dashboard-overview-v1', metrics: typeof metrics === 'string' ? metrics : JSON.stringify(metrics), version: input.version ?? existing?.version ?? 1, createdBy: input.createdBy, updatedBy: input.updatedBy });
}
function dashboardSnapshotRead(value: StoredRecord): StoredRecord {
  return { ...value, metrics: typeof value.metrics === 'string' ? parseObject(value.metrics) : value.metrics };
}
function pdfJobWrite(input: Record<string, unknown>): Record<string, unknown> {
  const objectPath = typeof input.pdfObjectPath === 'string' ? input.pdfObjectPath : '';
  const manifestPath = typeof input.renderManifestObjectPath === 'string' ? input.renderManifestObjectPath : '';
  return definedEntries({ agencyId: input.agencyId, status: input.status, taskId: input.taskId ?? input.id, reportId: input.reportId, reportVersionId: input.reportVersionId, currentVersionId: input.currentVersionId, priority: input.priority, requestedBy: input.requestedBy, queuedAt: input.queuedAt, renderId: input.renderId, canonicalInputHash: input.canonicalInputHash, pdfFileId: input.pdfFileId ?? (objectPath.startsWith('appwrite://reports/') ? objectPath.slice('appwrite://reports/'.length) : undefined), pdfSha256: input.pdfSha256, manifestId: input.manifestId ?? (manifestPath.startsWith('appwrite-table://report_render_manifests/') ? manifestPath.slice('appwrite-table://report_render_manifests/'.length) : undefined), manifestSha256: input.renderManifestSha256 ?? input.manifestSha256, errorCode: input.errorCode, errorMessage: input.errorMessage, retryable: input.retryable, startedAt: input.startedAt, completedAt: input.completedAt, failedAt: input.failedAt });
}
function pdfJobRead(value: StoredRecord): StoredRecord {
  const pdfFileId = typeof value.pdfFileId === 'string' ? value.pdfFileId : undefined; const manifestId = typeof value.manifestId === 'string' ? value.manifestId : undefined;
  return { ...value, ...(pdfFileId ? { pdfObjectPath: `appwrite://reports/${pdfFileId}`, pdfGeneration: 'appwrite-v1' } : {}), ...(manifestId ? { renderManifestObjectPath: `appwrite-table://report_render_manifests/${manifestId}` } : {}), ...(value.manifestSha256 ? { renderManifestSha256: value.manifestSha256 } : {}) };
}
const TEMPLATE_FIELDS = ['id','name','supportedInspectionTypes','page','typography','cover','sections'] as const;
const BRANDING_FIELDS = ['id','agencyName','tradingName','logoDocumentId','secondaryLogoDocumentId','abn','phone','email','website','address','primaryColour','secondaryColour','accentColour','headingFont','bodyFont','footerText','disclaimerId','disclaimerVersion'] as const;
function versionPayloadWrite(input: Record<string, unknown>, existing: StoredRecord | undefined, fields: readonly string[]): Record<string, unknown> {
  const contentChanged = fields.some((field) => Object.hasOwn(input, field));
  const content = { ...pick(existing as Record<string, unknown> | undefined, fields), ...pick(input, fields) };
  return definedEntries({ agencyId: input.agencyId, status: input.status ?? existing?.status, version: input.version ?? existing?.version ?? 1, immutable: input.immutable ?? existing?.immutable ?? false, publishedAt: input.publishedAt ?? existing?.publishedAt, retiredAt: input.retiredAt ?? existing?.retiredAt, ...(contentChanged || !existing ? { payload: JSON.stringify(content) } : {}) });
}
function versionPayloadRead(value: StoredRecord): StoredRecord {
  const payload = parseObject(value.payload); const { payload: _payload, ...rest } = value;
  return { ...rest, ...payload, id: typeof payload.id === 'string' && payload.id ? payload.id : value.id, status: value.status, version: value.version, immutable: value.immutable, ...(value.publishedAt ? { publishedAt: value.publishedAt } : {}), ...(value.retiredAt ? { retiredAt: value.retiredAt } : {}) };
}

export function appwriteCollectionWriteData(collection: string, input: Record<string, unknown>, existing?: StoredRecord): Record<string, unknown> {
  if (collection === 'integrationConnections') return integrationConnectionWrite(input);
  if (collection === 'integrationDeliveries') return integrationDeliveryWrite(input);
  if (collection === 'inspectionRequests') return inspectionRequestWrite(input);
  if (collection === 'inspectionServiceMappings' || collection === 'shopifyServiceMappings') return serviceMappingWrite(input);
  if (collection === 'dashboardMetricSnapshots') return dashboardSnapshotWrite(input, existing);
  if (collection === 'pdfJobs') return pdfJobWrite(input);
  if (collection === 'reportPresentationTemplateVersions') return versionPayloadWrite(input, existing, TEMPLATE_FIELDS);
  if (collection === 'reportBrandingProfileVersions') return versionPayloadWrite(input, existing, BRANDING_FIELDS);
  return input;
}
export function appwriteCollectionReadData(collection: string, value: StoredRecord): StoredRecord {
  if (collection === 'integrationConnections') return integrationConnectionRead(value);
  if (collection === 'integrationDeliveries') return integrationDeliveryRead(value);
  if (collection === 'inspectionRequests') return inspectionRequestRead(value);
  if (collection === 'inspectionServiceMappings' || collection === 'shopifyServiceMappings') return serviceMappingRead(value);
  if (collection === 'dashboardMetricSnapshots') return dashboardSnapshotRead(value);
  if (collection === 'pdfJobs') return pdfJobRead(value);
  if (collection === 'reportPresentationTemplateVersions' || collection === 'reportBrandingProfileVersions') return versionPayloadRead(value);
  return value;
}
`);

replaceOnce(
  'apps/api/src/services/settingsAwareOperationalRepository.ts',
  "    if (\n      collection === 'reportPresentationTemplateVersions' &&\n      text(next.status) !== 'draft'\n    ) {\n      throw repositoryConflict(\n        'PRESENTATION_TEMPLATE_DRAFT_REQUIRED',\n        'New report presentation templates must be created as drafts and published through the lifecycle command.',\n      );\n    }",
  "    if (\n      collection === 'reportPresentationTemplateVersions' &&\n      text(next.status) !== 'draft'\n    ) {\n      throw repositoryConflict(\n        'PRESENTATION_TEMPLATE_DRAFT_REQUIRED',\n        'New report presentation templates must be created as drafts and published through the lifecycle command.',\n      );\n    }\n    if (collection === 'reportBrandingProfileVersions' && text(next.status) !== 'draft') {\n      throw repositoryConflict(\n        'REPORT_BRANDING_PROFILE_DRAFT_REQUIRED',\n        'New report branding profile versions must be created as drafts and published through the lifecycle command.',\n      );\n    }",
);
replaceOnce(
  'apps/api/src/services/settingsAwareOperationalRepository.ts',
  "    return this.delegate.update(collection, agencyId, id, next, expectedVersion, actorId);",
  "    if (collection === 'reportBrandingProfileVersions') {\n      const current = await this.delegate.get(collection, agencyId, id);\n      if (!current) throw Object.assign(new Error('Report branding profile was not found.'), { status: 404, code: 'REPORT_BRANDING_PROFILE_NOT_FOUND' });\n      const currentStatus = text(current.status);\n      const nextStatus = text(next.status) || currentStatus;\n      const publishing = currentStatus === 'draft' && nextStatus === 'published';\n      const retiring = currentStatus === 'published' && nextStatus === 'retired';\n      if (currentStatus === 'retired' || (currentStatus === 'published' && !retiring)) {\n        throw repositoryConflict('REPORT_BRANDING_PROFILE_IMMUTABLE', 'Published or retired report branding profile versions are immutable. Create a new draft version instead.');\n      }\n      if (nextStatus !== currentStatus && !publishing && !retiring) {\n        throw repositoryConflict('REPORT_BRANDING_PROFILE_LIFECYCLE_INVALID', 'Report branding lifecycle changes must use draft to published or published to retired transitions.');\n      }\n    }\n    return this.delegate.update(collection, agencyId, id, next, expectedVersion, actorId);",
);

write('apps/api/src/backend/reportPresentationRoutes.ts', `import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  publishBrandingProfile,
  publishPresentationTemplate,
  validateBrandingProfile,
  validatePresentationTemplate,
  type ReportBrandingProfile,
  type ReportPresentationTemplate,
} from '@pcr/report-presentation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyHeader(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); if (!chunks.length) return {}; try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required'); return value as Record<string, unknown>; } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); } }
function expectedVersion(body: Record<string, unknown>): number { const value = body.expectedVersion; if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.'); return value; }
function asTemplate(record: StoredRecord): ReportPresentationTemplate { const value = structuredClone(record) as unknown as ReportPresentationTemplate; try { validatePresentationTemplate(value); } catch (error) { throw new ApiError(422, 'PRESENTATION_TEMPLATE_INVALID', error instanceof Error ? error.message : 'Presentation template is invalid.'); } return value; }
function asBranding(record: StoredRecord): ReportBrandingProfile { const value = structuredClone(record) as unknown as ReportBrandingProfile; try { validateBrandingProfile(value); } catch (error) { throw new ApiError(422, 'REPORT_BRANDING_PROFILE_INVALID', error instanceof Error ? error.message : 'Report branding profile is invalid.'); } return value; }
async function auditLifecycle(dependencies: ApiDependencies, input: { agencyId: string; actorId: string; actorRole: string; correlationId: string; id: string; action: 'published' | 'retired'; version: number; kind: 'template' | 'branding' }): Promise<void> {
  await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: input.actorId, actorRole: input.actorRole, agencyId: input.agencyId, capability: 'template.manage', outcome: 'allowed', reason: `report_presentation.${input.kind}.${input.action}`, target: { agencyId: input.agencyId }, correlationId: input.correlationId, entityType: input.kind === 'template' ? 'report_presentation_template' : 'report_branding_profile', entityId: input.id, eventType: `report_presentation.${input.kind}.${input.action}`, metadata: { version: input.version } });
}

export async function routeReportPresentationRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1') return undefined;
  const kind = route[2] === 'report-presentation-templates' ? 'template' : route[2] === 'report-branding-profiles' ? 'branding' : undefined;
  if (!kind) return undefined;
  const id = route[3]; const action = route[4] === 'actions' ? route[5] : undefined; if (!id || !action || req.method !== 'POST') return undefined;
  const agencyId = agencyHeader(req); const body = await readJson(req); const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const collection = kind === 'template' ? 'reportPresentationTemplateVersions' : 'reportBrandingProfileVersions';
  const existing = await dependencies.repository.get(collection, agencyId, id);
  if (!existing) throw new ApiError(404, kind === 'template' ? 'PRESENTATION_TEMPLATE_NOT_FOUND' : 'REPORT_BRANDING_PROFILE_NOT_FOUND', kind === 'template' ? 'Report presentation template was not found.' : 'Report branding profile was not found.');
  if (action === 'publish') {
    if (existing.status !== 'draft') throw new ApiError(409, kind === 'template' ? 'PRESENTATION_TEMPLATE_NOT_DRAFT' : 'REPORT_BRANDING_PROFILE_NOT_DRAFT', `Only draft report ${kind === 'template' ? 'presentation templates' : 'branding profiles'} can be published.`);
    const published = kind === 'template' ? publishPresentationTemplate(asTemplate(existing)) : publishBrandingProfile(asBranding(existing));
    const updated = await dependencies.repository.update(collection, agencyId, id, { status: published.status, publishedAt: published.publishedAt, immutable: true }, expectedVersion(body), principal.uid);
    await auditLifecycle(dependencies, { agencyId, actorId: principal.uid, actorRole: principal.role, correlationId, id, action: 'published', version: Number(updated.version), kind });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }
  if (action === 'retire') {
    if (existing.status !== 'published') throw new ApiError(409, kind === 'template' ? 'PRESENTATION_TEMPLATE_NOT_PUBLISHED' : 'REPORT_BRANDING_PROFILE_NOT_PUBLISHED', `Only a published report ${kind === 'template' ? 'presentation template' : 'branding profile'} can be retired.`);
    const updated = await dependencies.repository.update(collection, agencyId, id, { status: 'retired', retiredAt: new Date().toISOString(), immutable: true }, expectedVersion(body), principal.uid);
    await auditLifecycle(dependencies, { agencyId, actorId: principal.uid, actorRole: principal.role, correlationId, id, action: 'retired', version: Number(updated.version), kind });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }
  throw new ApiError(404, 'PRESENTATION_ACTION_NOT_FOUND', 'Report presentation action was not found.');
}
`);

write('apps/api/tests/appwritePresentationContracts.test.ts', `import { describe, expect, it } from 'vitest';
import { appwriteCollectionReadData, appwriteCollectionWriteData } from '../src/backend/appwriteCollectionTransforms.js';

const stored = (value: Record<string, unknown>) => ({ id: 'row-1', agencyId: 'agency-1', version: 1, createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z', ...value }) as never;

describe('Appwrite presentation and worker collection contracts', () => {
  it('serializes dashboard metrics into the canonical snapshot table', () => {
    const written = appwriteCollectionWriteData('dashboardMetricSnapshots', { agencyId: 'agency-1', capturedAt: '2026-09-15T01:00:00.000Z', metrics: { open: 4 } });
    expect(written.timezone).toBe('Australia/Perth'); expect(JSON.parse(String(written.metrics))).toEqual({ open: 4 });
    expect(appwriteCollectionReadData('dashboardMetricSnapshots', stored(written)).metrics).toEqual({ open: 4 });
  });
  it('maps API PDF jobs to worker job identity and Appwrite artifact locations', () => {
    const written = appwriteCollectionWriteData('pdfJobs', { id: 'task-1', agencyId: 'agency-1', reportId: 'report-1', reportVersionId: 'version-1', status: 'queued', priority: 'high', requestedBy: 'user-1' });
    expect(written.taskId).toBe('task-1'); expect(written.priority).toBe('high');
    const read = appwriteCollectionReadData('pdfJobs', stored({ ...written, pdfFileId: 'file-1', manifestId: 'manifest-1', manifestSha256: 'a'.repeat(64) }));
    expect(read.pdfObjectPath).toBe('appwrite://reports/file-1'); expect(read.renderManifestObjectPath).toBe('appwrite-table://report_render_manifests/manifest-1'); expect(read.pdfGeneration).toBe('appwrite-v1');
  });
  it('round-trips report presentation template payloads without flattening nested policy', () => {
    const input = { id: 'presentation-1', agencyId: 'agency-1', status: 'draft', name: 'Detailed', supportedInspectionTypes: ['entry'], page: { size: 'A4', marginMm: 12, showPageNumbers: true, showRunningHeader: true }, typography: { headingFont: 'Helvetica', bodyFont: 'Helvetica', baseFontSizePt: 9 }, cover: { style: 'corporate', showHeroPhoto: true, showClientName: true, showInspectorName: true }, sections: [{ id: 'cover', type: 'cover', visible: true }] };
    const written = appwriteCollectionWriteData('reportPresentationTemplateVersions', input); expect(typeof written.payload).toBe('string');
    const read = appwriteCollectionReadData('reportPresentationTemplateVersions', stored({ ...written, status: 'draft' })); expect(read.name).toBe('Detailed'); expect(read.page).toEqual(input.page); expect(read.sections).toEqual(input.sections);
  });
  it('round-trips versioned report branding payloads', () => {
    const input = { id: 'branding-1', agencyId: 'agency-1', status: 'draft', agencyName: 'ProInspect', primaryColour: '#1D4ED8', secondaryColour: '#0F172A', accentColour: '#0284C7', headingFont: 'Helvetica', bodyFont: 'Helvetica' };
    const written = appwriteCollectionWriteData('reportBrandingProfileVersions', input); const read = appwriteCollectionReadData('reportBrandingProfileVersions', stored({ ...written, status: 'draft' }));
    expect(read.agencyName).toBe('ProInspect'); expect(read.primaryColour).toBe('#1D4ED8');
  });
});
`);

write('apps/pdf-worker/src/pdfErrors.ts', `export class PdfWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) { super(message); }
}
`);

write('apps/pdf-worker/src/reportPresentationPreflight.ts', `import { createHash } from 'node:crypto';
import { Query, createAppwriteServerServices, loadAppwriteServerConfig } from '@pcr/appwrite-server';
import {
  captureBrandingSnapshot,
  validateBrandingProfile,
  validatePresentationTemplate,
  type ReportBrandingProfile,
  type ReportBrandingSnapshot,
  type ReportPresentationTemplate,
} from '@pcr/report-presentation';
import { presentationTemplateForReportType } from '@pcr/report-presentation/presets';
import { REPORT_FONT_BUNDLE_VERSION, REPORT_RENDERER_VERSION } from './index.js';
import { PdfWorkerError } from './pdfErrors.js';
import type { PdfGenerationTask } from './pdfGenerationService.js';

type Row = Record<string, unknown> & { $id: string; agencyId?: string };
export interface ReportPresentationPin {
  id: string; agencyId: string; reportId: string; reportVersionId: string;
  presentationTemplateRecordId: string; presentationTemplateId: string; presentationTemplateVersion: number; presentationTemplateSnapshot: ReportPresentationTemplate;
  brandingProfileRecordId: string; brandingProfileId: string; brandingProfileVersion: number; brandingSnapshot: ReportBrandingSnapshot; brandingSnapshotHash: string;
  rendererVersion: string; fontBundleVersion: string; capturedAt: string; immutable: true;
}
let cached: ReturnType<typeof createAppwriteServerServices> | undefined;
function services() { return cached ??= createAppwriteServerServices(loadAppwriteServerConfig()); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function positive(value: unknown): number | undefined { return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined; }
function appwriteCode(error: unknown): number | undefined { return error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : undefined; }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key, stable(item)])); return value; }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function deterministicId(prefix: string, value: string): string { return `${prefix}${createHash('sha256').update(value).digest('hex').slice(0, 35)}`; }
function parsePayload(value: unknown): Record<string, unknown> { try { return record(JSON.parse(text(value))); } catch { return {}; } }
function inspectionType(reportType: string): 'entry' | 'routine' | 'exit' | 'comparison' | 'maintenance' { const value = reportType.toLowerCase(); if (value.includes('routine')) return 'routine'; if (value.includes('exit')) return 'exit'; if (value.includes('comparison')) return 'comparison'; if (value.includes('maintenance') || value.includes('follow')) return 'maintenance'; return 'entry'; }
async function getRow(tableId: string, rowId: string): Promise<Row | undefined> { try { return await services().tables.getRow({ databaseId: services().databaseId, tableId, rowId }) as unknown as Row; } catch (error) { if (appwriteCode(error) === 404) return undefined; throw error; } }
async function listRows(tableId: string, agencyId: string, status = 'published'): Promise<Row[]> { const rows: Row[] = []; let cursor: string | undefined; for (let page = 0; page < 1000; page += 1) { const result = await services().tables.listRows({ databaseId: services().databaseId, tableId, queries: [Query.equal('agencyId', [agencyId]), Query.equal('status', [status]), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] }); const batch = result.rows as unknown as Row[]; rows.push(...batch); if (rows.length >= result.total || !batch.length) return rows; cursor = batch.at(-1)?.$id; if (!cursor) break; } throw new PdfWorkerError('PRESENTATION_PAGINATION_FAILED', `Could not paginate ${tableId}.`, true); }
function templateFromRow(row: Row): ReportPresentationTemplate { const payload = parsePayload(row.payload); const value = { ...payload, id: text(payload.id) || row.$id, version: positive(row.version) || 1, status: text(row.status) || text(payload.status), ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}), ...(row.retiredAt ? { retiredAt: row.retiredAt } : {}) } as unknown as ReportPresentationTemplate; validatePresentationTemplate(value); return value; }
function brandingFromRow(row: Row): ReportBrandingProfile { const payload = parsePayload(row.payload); const value = { ...payload, id: text(payload.id) || row.$id, version: positive(row.version) || 1, status: text(row.status) || text(payload.status), createdAt: text(payload.createdAt) || text(row.createdAt), ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}), ...(row.retiredAt ? { retiredAt: row.retiredAt } : {}) } as unknown as ReportBrandingProfile; validateBrandingProfile(value); return value; }
async function createVersionRow(tableId: string, rowId: string, agencyId: string, payload: Record<string, unknown>, version: number, capturedAt: string): Promise<Row> { const existing = await getRow(tableId, rowId); if (existing) return existing; try { return await services().tables.createRow({ databaseId: services().databaseId, tableId, rowId, permissions: [], data: { agencyId, status: 'published', version, payload: JSON.stringify(payload), immutable: true, publishedAt: capturedAt, createdAt: capturedAt, updatedAt: capturedAt, createdBy: 'system:pdf-worker', updatedBy: 'system:pdf-worker' } }) as unknown as Row; } catch (error) { if (appwriteCode(error) !== 409) throw error; const raced = await getRow(tableId, rowId); if (!raced) throw error; return raced; } }
async function selectTemplate(agencyId: string, reportType: string, preferredId: string, capturedAt: string): Promise<{ recordId: string; template: ReportPresentationTemplate }> { const kind = inspectionType(reportType); const candidates = (await listRows('report_presentation_template_versions', agencyId)).flatMap((row) => { try { return [{ row, template: templateFromRow(row) }]; } catch { return []; } }).filter(({ template }) => template.status === 'published' && template.supportedInspectionTypes?.includes(kind)).sort((left, right) => { const preferred = Number(right.row.$id === preferredId || right.template.id === preferredId) - Number(left.row.$id === preferredId || left.template.id === preferredId); const system = Number(left.template.id.startsWith('system-')) - Number(right.template.id.startsWith('system-')); return preferred || system || right.template.version - left.template.version || text(right.row.publishedAt).localeCompare(text(left.row.publishedAt)); }); if (candidates[0]) return { recordId: candidates[0].row.$id, template: candidates[0].template }; const preset = presentationTemplateForReportType(reportType, capturedAt); const template = { ...preset, version: 1, status: 'published', publishedAt: capturedAt } as ReportPresentationTemplate; const rowId = deterministicId('t', `${agencyId}:${hash(template)}`); const row = await createVersionRow('report_presentation_template_versions', rowId, agencyId, template as unknown as Record<string, unknown>, 1, capturedAt); return { recordId: row.$id, template: templateFromRow(row) }; }
async function selectBranding(agencyId: string, metadata: Record<string, unknown>, template: ReportPresentationTemplate, preferredId: string, capturedAt: string): Promise<{ recordId: string; profile: ReportBrandingProfile; snapshot: ReportBrandingSnapshot; snapshotHash: string }> { const candidates = (await listRows('report_branding_profile_versions', agencyId)).flatMap((row) => { try { return [{ row, profile: brandingFromRow(row) }]; } catch { return []; } }).filter(({ profile }) => profile.status === 'published').sort((left, right) => { const preferred = Number(right.row.$id === preferredId || right.profile.id === preferredId) - Number(left.row.$id === preferredId || left.profile.id === preferredId); const system = Number(left.profile.id.startsWith('system-')) - Number(right.profile.id.startsWith('system-')); return preferred || system || right.profile.version - left.profile.version || text(right.row.publishedAt).localeCompare(text(left.row.publishedAt)); }); let recordId: string; let profile: ReportBrandingProfile; if (candidates[0]) { recordId = candidates[0].row.$id; profile = candidates[0].profile; } else { profile = { id: 'system-report-branding', version: 1, status: 'published', agencyName: text(metadata.agentCompany) || text(metadata.agencyName) || 'ProInspect', ...(text(metadata.agentAddress) ? { address: text(metadata.agentAddress) } : {}), ...(text(metadata.agentPhone) ? { phone: text(metadata.agentPhone) } : {}), ...(text(metadata.agentEmail) ? { email: text(metadata.agentEmail) } : {}), primaryColour: '#1D4ED8', secondaryColour: '#0F172A', accentColour: '#0284C7', headingFont: template.typography.headingFont, bodyFont: template.typography.bodyFont, createdAt: capturedAt, publishedAt: capturedAt }; const rowId = deterministicId('b', `${agencyId}:${hash(profile)}`); const row = await createVersionRow('report_branding_profile_versions', rowId, agencyId, profile as unknown as Record<string, unknown>, 1, capturedAt); recordId = row.$id; profile = brandingFromRow(row); } const snapshot = captureBrandingSnapshot(profile, capturedAt); return { recordId, profile, snapshot, snapshotHash: hash(snapshot) }; }
function pinFromRow(row: Row): ReportPresentationPin { const template = parsePayload(row.presentationTemplateSnapshot) as unknown as ReportPresentationTemplate; const branding = parsePayload(row.brandingSnapshot) as unknown as ReportBrandingSnapshot; if (row.immutable !== true || !text(row.reportId) || !text(row.reportVersionId) || !text(row.presentationTemplateRecordId) || !text(row.brandingProfileRecordId) || !/^[a-f0-9]{64}$/u.test(text(row.brandingSnapshotHash))) throw new PdfWorkerError('PRESENTATION_PIN_INVALID', 'The version-scoped report presentation pin is incomplete.'); validatePresentationTemplate(template); if (!text(branding.profileId)) throw new PdfWorkerError('PRESENTATION_PIN_INVALID', 'Pinned branding snapshot is incomplete.'); return { id: row.$id, agencyId: text(row.agencyId), reportId: text(row.reportId), reportVersionId: text(row.reportVersionId), presentationTemplateRecordId: text(row.presentationTemplateRecordId), presentationTemplateId: text(row.presentationTemplateId), presentationTemplateVersion: positive(row.presentationTemplateVersion) || template.version, presentationTemplateSnapshot: template, brandingProfileRecordId: text(row.brandingProfileRecordId), brandingProfileId: text(row.brandingProfileId), brandingProfileVersion: positive(row.brandingProfileVersion) || branding.profileVersion, brandingSnapshot: branding, brandingSnapshotHash: text(row.brandingSnapshotHash), rendererVersion: text(row.rendererVersion), fontBundleVersion: text(row.fontBundleVersion), capturedAt: text(row.capturedAt), immutable: true }; }
export async function loadReportPresentationPin(agencyId: string, reportId: string, reportVersionId: string): Promise<ReportPresentationPin | undefined> { const row = await getRow('report_presentation_pins', deterministicId('n', `${agencyId}:${reportId}:${reportVersionId}`)); if (!row || row.agencyId !== agencyId || text(row.reportId) !== reportId || text(row.reportVersionId) !== reportVersionId) return undefined; return pinFromRow(row); }
export async function ensureReportPresentationPin(task: PdfGenerationTask): Promise<ReportPresentationPin> { const report = await getRow('reports', task.reportId); if (!report || report.agencyId !== task.agencyId) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.'); const reportVersionId = task.reportVersionId?.trim() || text(report.currentVersionId); if (!reportVersionId) throw new PdfWorkerError('REPORT_VERSION_REQUIRED', 'A current report version is required before presentation can be pinned.'); const current = await loadReportPresentationPin(task.agencyId, task.reportId, reportVersionId); if (current) return current; const version = await getRow('report_versions', reportVersionId); if (!version || version.agencyId !== task.agencyId || text(version.reportId) !== task.reportId) throw new PdfWorkerError('REPORT_VERSION_NOT_FOUND', 'The current Appwrite report snapshot does not exist.'); const aggregate = parsePayload(version.snapshot); const metadata = record(aggregate.report); const capturedAt = text(version.createdAt) || new Date().toISOString(); const reportType = text(metadata.reportType) || 'Property Condition Report'; let templateRecordId: string; let template: ReportPresentationTemplate; const legacyTemplate = record(metadata.presentationTemplateSnapshot); try { if (text(legacyTemplate.id) && text(legacyTemplate.status) === 'published') { validatePresentationTemplate(legacyTemplate as unknown as ReportPresentationTemplate); template = legacyTemplate as unknown as ReportPresentationTemplate; const rowId = deterministicId('t', `${task.agencyId}:${hash(template)}`); templateRecordId = (await createVersionRow('report_presentation_template_versions', rowId, task.agencyId, template as unknown as Record<string, unknown>, template.version, capturedAt)).$id; } else throw new Error('no legacy template'); } catch { const selected = await selectTemplate(task.agencyId, reportType, text(metadata.presentationTemplateId), capturedAt); templateRecordId = selected.recordId; template = selected.template; } let brandingRecordId: string; let brandingSnapshot: ReportBrandingSnapshot; let brandingSnapshotHash: string; let brandingProfileId: string; let brandingProfileVersion: number; const legacyBranding = record(metadata.brandingSnapshot); if (text(legacyBranding.profileId)) { brandingSnapshot = legacyBranding as unknown as ReportBrandingSnapshot; brandingSnapshotHash = /^[a-f0-9]{64}$/u.test(text(metadata.brandingSnapshotHash)) ? text(metadata.brandingSnapshotHash) : hash(brandingSnapshot); brandingProfileId = text(brandingSnapshot.profileId); brandingProfileVersion = positive(brandingSnapshot.profileVersion) || 1; const profile = { ...brandingSnapshot, id: brandingProfileId, version: brandingProfileVersion, status: 'published', createdAt: capturedAt, publishedAt: capturedAt } as unknown as ReportBrandingProfile; const rowId = deterministicId('b', `${task.agencyId}:${hash(profile)}`); brandingRecordId = (await createVersionRow('report_branding_profile_versions', rowId, task.agencyId, profile as unknown as Record<string, unknown>, brandingProfileVersion, capturedAt)).$id; } else { const selected = await selectBranding(task.agencyId, metadata, template, text(metadata.brandingProfileId), capturedAt); brandingRecordId = selected.recordId; brandingSnapshot = selected.snapshot; brandingSnapshotHash = selected.snapshotHash; brandingProfileId = selected.profile.id; brandingProfileVersion = selected.profile.version; } const pinId = deterministicId('n', `${task.agencyId}:${task.reportId}:${reportVersionId}`); const now = new Date().toISOString(); const data = { agencyId: task.agencyId, status: 'active', reportId: task.reportId, reportVersionId, presentationTemplateRecordId: templateRecordId, presentationTemplateId: template.id, presentationTemplateVersion: template.version, presentationTemplateSnapshot: JSON.stringify(template), brandingProfileRecordId: brandingRecordId, brandingProfileId, brandingProfileVersion, brandingSnapshot: JSON.stringify(brandingSnapshot), brandingSnapshotHash, rendererVersion: REPORT_RENDERER_VERSION, fontBundleVersion: REPORT_FONT_BUNDLE_VERSION, capturedAt: now, immutable: true, createdAt: now, updatedAt: now, createdBy: task.requestedBy || 'system:pdf-worker', updatedBy: task.requestedBy || 'system:pdf-worker' }; try { const row = await services().tables.createRow({ databaseId: services().databaseId, tableId: 'report_presentation_pins', rowId: pinId, permissions: [], data }) as unknown as Row; return pinFromRow(row); } catch (error) { if (appwriteCode(error) !== 409) throw error; const raced = await loadReportPresentationPin(task.agencyId, task.reportId, reportVersionId); if (!raced) throw error; return raced; } }
`);

write('apps/pdf-worker/src/pdfTaskPreflight.ts', `import { createAppwriteServerServices, loadAppwriteServerConfig } from '@pcr/appwrite-server';
import { PdfWorkerError } from './pdfErrors.js';
import { ensureReportPresentationPin } from './reportPresentationPreflight.js';
import type { PdfGenerationTask } from './pdfGenerationService.js';

type Row = Record<string, unknown> & { $id: string; agencyId?: string };
let cached: ReturnType<typeof createAppwriteServerServices> | undefined;
function services() { return cached ??= createAppwriteServerServices(loadAppwriteServerConfig()); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function appwriteCode(error: unknown): number | undefined { return error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : undefined; }
async function row(tableId: string, rowId: string): Promise<Row | undefined> { try { return await services().tables.getRow({ databaseId: services().databaseId, tableId, rowId }) as unknown as Row; } catch (error) { if (appwriteCode(error) === 404) return undefined; throw error; } }
async function recordFailure(task: PdfGenerationTask, error: unknown): Promise<void> { const workerError = error instanceof PdfWorkerError ? error : undefined; if (workerError?.retryable) return; const now = new Date().toISOString(); const data = { agencyId: task.agencyId, status: 'failed', taskId: task.taskId, reportId: task.reportId, ...(task.reportVersionId ? { reportVersionId: task.reportVersionId } : {}), errorCode: workerError?.code ?? 'PDF_PREFLIGHT_FAILED', errorMessage: error instanceof Error ? error.message : String(error), retryable: false, failedAt: now, createdAt: now, updatedAt: now, createdBy: 'system:pdf-worker', updatedBy: 'system:pdf-worker' }; try { const existing = await row('pdf_jobs', task.taskId); if (existing && existing.agencyId === task.agencyId) await services().tables.updateRow({ databaseId: services().databaseId, tableId: 'pdf_jobs', rowId: task.taskId, data: { ...data, createdAt: existing.createdAt, createdBy: existing.createdBy } }); else if (!existing) await services().tables.createRow({ databaseId: services().databaseId, tableId: 'pdf_jobs', rowId: task.taskId, permissions: [], data }); } catch { /* preserve original permanent preflight error */ } }
export async function assertPdfTaskReady(task: PdfGenerationTask): Promise<void> { try { const report = await row('reports', task.reportId); if (!report || report.agencyId !== task.agencyId) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.'); const lifecycle = text(report.lifecycleStatus); if (!['finalisation_ready','finalised'].includes(lifecycle)) throw new PdfWorkerError('REPORT_NOT_FINALISATION_READY', 'Final PDF generation requires a content-locked finalisation-ready or finalised report.'); const currentVersionId = text(report.currentVersionId); if (!currentVersionId) throw new PdfWorkerError('REPORT_VERSION_REQUIRED', 'A current report version is required before PDF generation.'); if (task.reportVersionId && task.reportVersionId !== currentVersionId) throw new PdfWorkerError('REPORT_VERSION_SUPERSEDED', 'The requested report version is no longer current.', false, { requestedVersionId: task.reportVersionId, currentVersionId }); const version = await row('report_versions', currentVersionId); if (!version || version.agencyId !== task.agencyId || text(version.reportId) !== task.reportId) throw new PdfWorkerError('REPORT_VERSION_NOT_FOUND', 'The current Appwrite report snapshot does not exist.'); await ensureReportPresentationPin({ ...task, reportVersionId: currentVersionId }); } catch (error) { await recordFailure(task, error); throw error; } }
`);

replaceOnce(
  'apps/pdf-worker/src/pdfGenerationService.ts',
  "import {\n  buildRenderManifest, buildRenderPackage, canonicalJson, renderReportPdf, sha256,\n  type RenderAsset, type RenderInput,\n} from './index.js';\n",
  "import {\n  buildRenderManifest, buildRenderPackage, canonicalJson, renderReportPdf, sha256,\n  type RenderAsset, type RenderInput,\n} from './index.js';\nimport { PdfWorkerError } from './pdfErrors.js';\nimport { loadReportPresentationPin } from './reportPresentationPreflight.js';\nexport { PdfWorkerError } from './pdfErrors.js';\n",
);
replaceBetween(
  'apps/pdf-worker/src/pdfGenerationService.ts',
  'export class PdfWorkerError extends Error {',
  'type Row =',
  '',
);
replaceBetween(
  'apps/pdf-worker/src/pdfGenerationService.ts',
  'async function approvedInput(',
  '\n\nasync function savePdf',
  `async function approvedInput(task: PdfGenerationTask): Promise<{ renderInput: RenderInput; imageBytes: Map<string, Uint8Array>; reportVersion: Row; inspectionJobId?: string }> {
  const report = await getRow('reports', task.reportId);
  if (!report || report.agencyId !== task.agencyId) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.');
  const reportVersionId = task.reportVersionId?.trim() || text(report.currentVersionId);
  if (!reportVersionId) throw new PdfWorkerError('REPORT_VERSION_REQUIRED', 'A report version is required.');
  const version = await getRow('report_versions', reportVersionId);
  if (!version || version.agencyId !== task.agencyId || text(version.reportId) !== task.reportId) throw new PdfWorkerError('REPORT_VERSION_NOT_FOUND', 'The requested Appwrite report version does not exist.');
  let aggregate: Record<string, unknown>;
  try { aggregate = asRecord(JSON.parse(text(version.snapshot))); } catch { throw new PdfWorkerError('REPORT_SNAPSHOT_INVALID', 'The Appwrite report version snapshot is invalid.'); }
  const metadata = asRecord(aggregate.report);
  const areas = Array.isArray(aggregate.areas) ? aggregate.areas.map(asRecord) : [];
  if (!areas.length) throw new PdfWorkerError('REPORT_VERSION_EMPTY', 'The report snapshot contains no areas.');
  const pin = await loadReportPresentationPin(task.agencyId, task.reportId, reportVersionId);
  if (!pin) throw new PdfWorkerError('PRESENTATION_NOT_PINNED', 'The report version does not have an immutable presentation pin.');
  const renderMetadata = { ...metadata, presentationTemplateId: pin.presentationTemplateId, presentationTemplateVersion: pin.presentationTemplateVersion, presentationTemplateSnapshot: pin.presentationTemplateSnapshot, brandingProfileId: pin.brandingProfileId, brandingProfileVersion: pin.brandingProfileVersion, brandingSnapshot: pin.brandingSnapshot, brandingSnapshotHash: pin.brandingSnapshotHash, presentationPinnedAt: pin.capturedAt };
  const responses = await agencyRows('report_recipient_responses', task.agencyId, [Query.equal('reportId', [task.reportId])]);
  const ids = new Set(deduplicatePhotoIds(areas)); for (const response of responses) for (const id of tenantEvidenceIds(response)) ids.add(id);
  const assets: RenderAsset[] = []; const imageBytes = new Map<string, Uint8Array>();
  for (const photoId of [...ids].sort()) { const evidence = await evidenceForPhoto(task.agencyId, photoId); const loaded = await verifiedFile(evidence, `Evidence image ${photoId}`); loaded.asset.photoId = photoId; assets.push(loaded.asset); if (loaded.bytes) imageBytes.set(photoId, loaded.bytes); }
  const logoId = text(pin.brandingSnapshot.logoDocumentId);
  if (logoId) { const evidence = await evidenceForPhoto(task.agencyId, logoId); const loaded = await verifiedFile(evidence, 'Pinned branding logo'); if (!loaded.bytes) throw new PdfWorkerError('BRANDING_LOGO_FORMAT_UNSUPPORTED', 'Pinned branding logo must be PNG or JPEG.'); loaded.asset.photoId = logoId; assets.push(loaded.asset); imageBytes.set(logoId, loaded.bytes); }
  const reportType = text(metadata.reportType) || 'Property Condition Report';
  const renderInput = { reportId: task.reportId, reportVersionId, templateId: text(metadata.templateId) || text(version.templateId) || templateIdFor(reportType), templateVersion: positiveInteger(metadata.templateVersion ?? version.templateVersion), approvedAt: text(version.createdAt) || text(metadata.updatedAt) || new Date().toISOString(), approvedBy: text(version.createdBy) || task.requestedBy || 'system', report: structuredClone(renderMetadata), areas: structuredClone(areas), assets, ...(responses.length ? { tenantResponses: structuredClone(responses) } : {}), presentationTemplateId: pin.presentationTemplateId, presentationTemplateVersion: pin.presentationTemplateVersion, brandingSnapshotHash: pin.brandingSnapshotHash, rendererVersion: pin.rendererVersion, fontBundleVersion: pin.fontBundleVersion };
  return { renderInput, imageBytes, reportVersion: version, ...(text(report.inspectionJobId) ? { inspectionJobId: text(report.inspectionJobId) } : {}) };
}`,
);

console.log('Applied final repository-only Appwrite/presentation remediation.');
