import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { tables } from './schema.mjs';
import { unifiedPlatformExtensionTables } from './unified-platform-extensions.mjs';
import { workerRuntimeExtensionTables } from './worker-runtime-extensions.mjs';
import { foundationReconciliation, RECONCILIATION_STATUSES } from './reconciliation.mjs';

const allTables = [...tables, ...unifiedPlatformExtensionTables, ...workerRuntimeExtensionTables];

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
    expect(byId.get('dashboard_metric_snapshots').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['agency_date','agency_captured']));
    expect(byId.get('document_template_versions').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['template_version','purpose_status']));
    expect(byId.get('external_operational_statuses').indexes.map((item) => item.key)).toEqual(expect.arrayContaining(['provider_entity','provider_retrieved']));
  });

  it('reconciles every original foundation table and includes source-backed and unified-platform gaps', () => {
    expect(foundationReconciliation).toHaveLength(67);
    expect(new Set(foundationReconciliation.map((item) => item.table)).size).toBe(67);
    for (const item of foundationReconciliation) expect(RECONCILIATION_STATUSES).toContain(item.status);
    const ids = new Set(allTables.map((item) => item.$id));
    for (const item of foundationReconciliation) expect(ids.has(item.table), item.table).toBe(true);
    for (const required of ['people','tenants','tenancies','tenancy_participants','occupancies','units','contractors','key_register','access_device_requests','defects','operational_inspection_checkpoints','operational_inspection_results','tasks','documents','form_submissions','property_operating_settings','portal_entitlements','contractor_compliance','offer_partners','offers','offer_redemptions','conversations','conversation_participants','conversation_messages','notification_preferences','appointment_availability','appointment_bookings','route_plans','route_plan_stops','offline_sync_receipts','people_invitations','workforce_profiles','external_access_grants','client_approvals','dashboard_metric_snapshots','document_template_versions','external_operational_statuses']) {
      expect(ids.has(required), required).toBe(true);
    }
    expect(allTables).toHaveLength(123);
  });
});
