import { canonicalChecksum, deterministicId, planMigrationBatch } from './framework.mjs';

/**
 * Complete source disposition for the 49-table Strata D1 schema.
 * Credentials and sessions are intentionally omitted; identity is recreated in Appwrite Auth.
 */
export const strataD1Manifest = Object.freeze({
  access_device_history: { targetTables: ['access_device_history'], mode: 'migrate', parents: ['access_devices'] },
  access_device_requests: { targetTables: ['access_device_requests'], mode: 'migrate', parents: ['properties', 'units', 'people'] },
  access_devices: { targetTables: ['access_devices'], mode: 'migrate', parents: ['properties', 'units', 'people'] },
  approvals: { targetTables: ['operational_approvals'], mode: 'migrate', parents: ['properties'] },
  assets: { targetTables: ['assets'], mode: 'migrate', parents: ['properties'] },
  audit_events: { targetTables: ['audit_events'], mode: 'migrate', parents: ['properties'] },
  buildings: { targetTables: ['buildings'], mode: 'migrate', parents: ['properties'] },
  bylaw_observations: { targetTables: ['bylaw_observations'], mode: 'migrate', parents: ['properties', 'units', 'people'] },
  calendar_events: { targetTables: ['calendar_events'], mode: 'migrate', parents: ['properties'] },
  communications: { targetTables: ['communications'], mode: 'migrate', parents: ['properties'] },
  contractor_attendance: { targetTables: ['contractor_attendance'], mode: 'migrate', parents: ['properties', 'contractors'] },
  contractors: { targetTables: ['contractors'], mode: 'migrate', parents: ['properties'] },
  daily_activity_logs: { targetTables: ['daily_activity_logs'], mode: 'migrate', parents: ['properties'] },
  defect_evidence: { targetTables: ['evidence_files'], mode: 'migrate', parents: ['defects'] },
  defects: { targetTables: ['defects'], mode: 'migrate', parents: ['properties'] },
  documents: { targetTables: ['documents'], mode: 'migrate', parents: ['properties'] },
  form_submissions: { targetTables: ['form_submissions'], mode: 'migrate', parents: ['properties'] },
  handover_checklist_items: { targetTables: ['handover_checklist_items'], mode: 'migrate', parents: ['handovers'] },
  handovers: { targetTables: ['handovers'], mode: 'migrate', parents: ['properties'] },
  incidents: { targetTables: ['incidents'], mode: 'migrate', parents: ['properties'] },
  inspection_checkpoints: { targetTables: ['operational_inspection_checkpoints'], mode: 'migrate', parents: ['inspection_templates'] },
  inspection_results: { targetTables: ['operational_inspection_results'], mode: 'migrate', parents: ['inspections', 'inspection_checkpoints'] },
  inspection_templates: { targetTables: ['inspection_templates'], mode: 'migrate', parents: ['properties'] },
  inspections: { targetTables: ['operational_inspections'], mode: 'migrate', parents: ['properties', 'inspection_templates'] },
  integration_outbox: { targetTables: ['integration_outbox'], mode: 'conditional', parents: ['properties'], rule: 'Only pending or failed deliveries inside the cutover window are eligible.' },
  inventory_items: { targetTables: ['inventory_items'], mode: 'migrate', parents: ['properties'] },
  key_transactions: { targetTables: ['key_transactions'], mode: 'migrate', parents: ['keys_register'] },
  keys_register: { targetTables: ['key_register'], mode: 'migrate', parents: ['properties'] },
  locations: { targetTables: ['property_areas'], mode: 'migrate', parents: ['properties', 'buildings'] },
  maintenance_plans: { targetTables: ['maintenance_plans'], mode: 'migrate', parents: ['properties', 'assets'] },
  monthly_report_drafts: { targetTables: ['operational_report_drafts', 'operational_reports'], mode: 'conditional', parents: ['properties'], rule: 'Finalised drafts also create immutable operational report releases.' },
  move_bookings: { targetTables: ['move_bookings'], mode: 'migrate', parents: ['properties', 'units', 'people'] },
  notices: { targetTables: ['notices'], mode: 'migrate', parents: ['properties'] },
  notifications: { targetTables: ['notifications'], mode: 'conditional', parents: ['properties'], rule: 'Migrate only records required by approved retention policy.' },
  occupancies: { targetTables: ['occupancies'], mode: 'migrate', parents: ['properties', 'units', 'people'] },
  people: { targetTables: ['people'], mode: 'migrate', parents: ['properties'] },
  properties: { targetTables: ['managed_sites'], mode: 'migrate', parents: [] },
  property_operating_settings: { targetTables: ['property_operating_settings'], mode: 'migrate', parents: ['properties'] },
  quotes: { targetTables: ['operational_quotes'], mode: 'migrate', parents: ['properties', 'contractors'] },
  resident_onboarding: { targetTables: ['resident_onboarding'], mode: 'migrate', parents: ['properties', 'units', 'people'] },
  resident_requests: { targetTables: ['resident_requests'], mode: 'migrate', parents: ['properties', 'units', 'people'] },
  service_events: { targetTables: ['service_events'], mode: 'migrate', parents: ['properties', 'assets', 'maintenance_plans'] },
  sessions: { targetTables: [], mode: 'omit', parents: ['users'], rule: 'Legacy sessions and password material are never migrated.' },
  tasks: { targetTables: ['tasks'], mode: 'migrate', parents: ['properties'] },
  units: { targetTables: ['units', 'properties'], mode: 'conditional', parents: ['properties', 'buildings'], rule: 'Every D1 unit creates a unit; inspectable property creation follows the approved unit policy.' },
  users: { targetTables: ['user_profiles', 'agency_memberships', 'site_memberships', 'portal_entitlements'], mode: 'conditional', parents: ['properties', 'people'], rule: 'No password hash or session is copied; users receive Appwrite invitations or matched identities.' },
  waste_events: { targetTables: ['waste_events'], mode: 'migrate', parents: ['properties', 'waste_services'] },
  waste_services: { targetTables: ['waste_services'], mode: 'migrate', parents: ['properties'] },
  work_orders: { targetTables: ['operational_work_orders'], mode: 'migrate', parents: ['properties', 'defects', 'contractors'] },
});

export const strataD1SourceTables = Object.freeze(Object.keys(strataD1Manifest).sort());

export function validateStrataD1Manifest(expectedTables = strataD1SourceTables) {
  const actual = new Set(strataD1SourceTables);
  const expected = new Set(expectedTables);
  const missing = [...expected].filter((table) => !actual.has(table)).sort();
  const extra = [...actual].filter((table) => !expected.has(table)).sort();
  const invalid = Object.entries(strataD1Manifest)
    .filter(([, entry]) => !['migrate', 'conditional', 'omit'].includes(entry.mode))
    .map(([table]) => table);
  return { valid: missing.length === 0 && extra.length === 0 && invalid.length === 0, missing, extra, invalid };
}

export function inventoryStrataExport(exportData) {
  const counts = {};
  const checksums = {};
  const errors = [];
  for (const table of strataD1SourceTables) {
    const rows = exportData?.[table];
    if (!Array.isArray(rows)) {
      errors.push(`${table}: expected an array export.`);
      counts[table] = 0;
      checksums[table] = canonicalChecksum([]);
      continue;
    }
    counts[table] = rows.length;
    checksums[table] = canonicalChecksum(rows);
  }
  const unknownTables = Object.keys(exportData ?? {}).filter((table) => !strataD1Manifest[table]).sort();
  return { valid: errors.length === 0 && unknownTables.length === 0, counts, checksums, errors, unknownTables };
}

export function planStrataTable({ agencyId, sourceTable, records, transform, existingMappings = [] }) {
  const disposition = strataD1Manifest[sourceTable];
  if (!disposition) throw new Error(`Unmapped Strata D1 table: ${sourceTable}.`);
  if (disposition.mode === 'omit') {
    return {
      sourceTable,
      mode: disposition.mode,
      targetTables: [],
      records: records.map((record) => ({ sourceId: String(record.id ?? ''), omitted: true, reason: disposition.rule })),
      sourceCount: records.length,
      targetCount: 0,
      sourceChecksum: canonicalChecksum(records),
      targetChecksum: canonicalChecksum([]),
    };
  }
  if (typeof transform !== 'function') throw new Error(`A transform is required for ${sourceTable}.`);
  const primaryTarget = disposition.targetTables[0];
  const planned = planMigrationBatch({
    sourceSystem: 'strata_d1',
    sourceEntity: sourceTable,
    targetTable: primaryTarget,
    agencyId,
    records,
    existingMappings,
    transform: (record) => {
      const target = transform(record, disposition);
      return {
        ...target,
        agencyId,
        legacySystem: 'strata_d1',
        legacyId: String(record.id),
        id: target.id ?? deterministicId('strata_d1', sourceTable, String(record.id)),
      };
    },
  });
  return { ...planned, sourceTable, mode: disposition.mode, targetTables: disposition.targetTables, rule: disposition.rule };
}

export function reconciliationSummary(plans) {
  return plans.map((plan) => ({
    sourceTable: plan.sourceTable,
    mode: plan.mode,
    targetTables: plan.targetTables,
    sourceCount: plan.sourceCount,
    targetCount: plan.targetCount,
    sourceChecksum: plan.sourceChecksum,
    targetChecksum: plan.targetChecksum,
    errors: plan.errors ?? [],
  }));
}
