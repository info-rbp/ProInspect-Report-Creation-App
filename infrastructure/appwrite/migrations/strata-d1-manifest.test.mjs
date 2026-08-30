import { describe, expect, it } from 'vitest';
import {
  inventoryStrataExport,
  planStrataTable,
  strataD1Manifest,
  strataD1SourceTables,
  validateStrataD1Manifest,
} from './strata-d1-manifest.mjs';

const EXPECTED_TABLES = [
  'access_device_history','access_device_requests','access_devices','approvals','assets','audit_events',
  'buildings','bylaw_observations','calendar_events','communications','contractor_attendance','contractors',
  'daily_activity_logs','defect_evidence','defects','documents','form_submissions','handover_checklist_items',
  'handovers','incidents','inspection_checkpoints','inspection_results','inspection_templates','inspections',
  'integration_outbox','inventory_items','key_transactions','keys_register','locations','maintenance_plans',
  'monthly_report_drafts','move_bookings','notices','notifications','occupancies','people','properties',
  'property_operating_settings','quotes','resident_onboarding','resident_requests','service_events','sessions',
  'tasks','units','users','waste_events','waste_services','work_orders',
].sort();

describe('Strata D1 manifest', () => {
  it('covers all 49 source tables exactly', () => {
    expect(strataD1SourceTables).toEqual(EXPECTED_TABLES);
    expect(Object.keys(strataD1Manifest)).toHaveLength(49);
    expect(validateStrataD1Manifest(EXPECTED_TABLES)).toEqual({
      valid: true, missing: [], extra: [], invalid: [],
    });
  });

  it('omits legacy sessions rather than treating credentials as operational data', () => {
    const plan = planStrataTable({
      agencyId: 'agency-1',
      sourceTable: 'sessions',
      records: [{ id: 'session-1', token_hash: 'secret' }],
    });
    expect(plan).toMatchObject({ mode: 'omit', sourceCount: 1, targetCount: 0 });
    expect(plan.records[0]).toMatchObject({ sourceId: 'session-1', omitted: true });
  });

  it('produces deterministic plans for migrated records', () => {
    const input = {
      agencyId: 'agency-1',
      sourceTable: 'properties',
      records: [{ id: 'site-1', name: 'Prima Apartments' }],
      transform: (record) => ({ name: record.name, status: 'active' }),
    };
    const first = planStrataTable(input);
    const second = planStrataTable(input);
    expect(first).toEqual(second);
    expect(first.records[0].target).toMatchObject({
      name: 'Prima Apartments',
      agencyId: 'agency-1',
      legacySystem: 'strata_d1',
      legacyId: 'site-1',
    });
  });

  it('fails closed when an export omits a source table or includes unknown data', () => {
    const exportData = Object.fromEntries(EXPECTED_TABLES.map((table) => [table, []]));
    delete exportData.defects;
    exportData.unexpected = [];
    const inventory = inventoryStrataExport(exportData);
    expect(inventory.valid).toBe(false);
    expect(inventory.errors).toContain('defects: expected an array export.');
    expect(inventory.unknownTables).toEqual(['unexpected']);
  });
});
