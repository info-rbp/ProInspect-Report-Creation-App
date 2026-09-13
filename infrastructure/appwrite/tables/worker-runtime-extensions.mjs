const str = (key, size = 255, required = false, format) => ({ key, type: 'string', size, required, ...(format ? { format } : {}) });
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
  return {
    $id: id,
    databaseId: 'proinspect_core',
    name: id.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    $permissions: [], rowSecurity: true, enabled: true,
    columns: [...new Map(columns.map((column) => [column.key, column])).values()],
    indexes,
  };
}
function agencyEntity(id, columns = [], indexes = []) {
  return table(id, [...agencyBase, ...columns], [index('agency_status', ['agencyId', 'status']), ...indexes]);
}

// Canonical Appwrite contracts required by the five standalone workers. These are
// separated from the original 120-table foundation so additions remain explicit
// and reviewable rather than being hidden inside legacy compatibility adapters.
export const workerRuntimeExtensionTables = [
  agencyEntity('dashboard_metric_snapshots', [
    str('dateKey', 10, true), datetime('capturedAt', true), str('timezone', 64, true),
    str('source', 128, true), text('metrics', true), integer('version', true),
  ], [
    unique('agency_date', ['agencyId', 'dateKey']),
    index('agency_captured', ['agencyId', 'capturedAt']),
  ]),
  agencyEntity('document_template_versions', [
    str('templateId', 36, true), integer('version', true), str('purpose', 64, true),
    str('sourceEvidenceFileId', 36, true), str('sourceSha256', 128, true),
    text('fieldSchema', true), datetime('publishedAt'), boolean('immutable', true),
  ], [
    unique('template_version', ['templateId', 'version']),
    index('purpose_status', ['purpose', 'status']),
  ]),
  agencyEntity('external_operational_statuses', [
    str('provider', 64, true), str('entityType', 64, true), str('externalEntityId', 255, true),
    str('rentStatus', 64), str('bondStatus', 64), str('invoiceStatus', 64),
    datetime('retrievedAt', true), text('sourceSnapshot'),
  ], [
    unique('provider_entity', ['agencyId', 'provider', 'entityType', 'externalEntityId']),
    index('provider_retrieved', ['provider', 'retrievedAt']),
  ]),
];
