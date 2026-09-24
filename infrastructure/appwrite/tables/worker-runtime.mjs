// Agency-scoped canonical state for compute workers. Never a legacy writeback.
export const workerRuntimeTableIds = [
  'notification_jobs', 'notification_rules', 'communication_templates',
  'notification_escalations', 'tenant_automation_events', 'agency_settings',
  'integration_credentials', 'integration_sync_runs', 'external_references',
  'external_operational_statuses', 'dashboard_metric_snapshots',
  'document_template_versions', 'document_packets', 'compliance_obligations',
  'report_presentation_versions', 'branding_profiles', 'pdf_jobs', 'remote_inspection_assignments',
];
export const workerRuntimeTables = workerRuntimeTableIds.map(($id) => ({
  $id, databaseId: 'proinspect_core', name: $id.replaceAll('_', ' '),
  $permissions: [], rowSecurity: true, enabled: true,
  columns: [
    { key: 'agencyId', type: 'string', size: 36, required: true },
    { key: 'status', type: 'string', size: 64, required: true },
    { key: 'logicalId', type: 'string', size: 255, required: true },
    { key: 'payload', type: 'longtext', required: true },
    { key: 'version', type: 'integer', required: true },
    { key: 'createdAt', type: 'datetime', required: true },
    { key: 'updatedAt', type: 'datetime', required: true },
    { key: 'createdBy', type: 'string', size: 36, required: false },
    { key: 'updatedBy', type: 'string', size: 36, required: false },
  ],
  indexes: [
    { key: 'agency_status', type: 'key', columns: ['agencyId', 'status'] },
    { key: 'agency_logical_id', type: 'unique', columns: ['agencyId', 'logicalId'] },
  ],
}));
