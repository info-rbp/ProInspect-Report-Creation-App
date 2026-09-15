const str = (key, size = 255, required = false) => ({ key, type: 'string', size, required });
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
    datetime('capturedAt', true),
    str('timezone', 64, true),
    str('source', 128, true),
    text('metrics', true),
    integer('version', true),
  ], [index('agency_captured', ['agencyId', 'capturedAt'], ['ASC', 'DESC'])]),
];
