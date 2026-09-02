import { Client, Query, TablesDB } from 'node-appwrite';
import { assertDevelopmentTarget } from './safety.mjs';

const target = assertDevelopmentTarget({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
}, process.env.APPWRITE_CONFIRM_TEST);
if (!process.env.APPWRITE_SEED_PASSWORD) throw new Error('APPWRITE_SEED_PASSWORD is required.');

const databaseId = 'proinspect_core';

async function authenticate(userId) {
  const response = await fetch(`${target.endpoint}/account/sessions/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-appwrite-project': target.projectId },
    body: JSON.stringify({ email: `${userId}@example.com`, password: process.env.APPWRITE_SEED_PASSWORD }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Email/password authentication failed for ${userId} with HTTP ${response.status}.`);
  const fallback = response.headers.get('x-fallback-cookies');
  const fallbackCookies = fallback ? JSON.parse(fallback) : {};
  const session = payload.secret || fallbackCookies[`a_session_${target.projectId}`];
  if (!session) throw new Error(`Authentication for ${userId} returned no usable session.`);
  return session;
}

function tablesFor(session) {
  const client = new Client().setEndpoint(target.endpoint).setProject(target.projectId).setSession(session);
  return new TablesDB(client);
}

async function expectRow(tables, tableId, rowId, label) {
  const row = await tables.getRow({ databaseId, tableId, rowId });
  if (row.$id !== rowId) throw new Error(`${label} returned the wrong row.`);
  return row;
}

async function expectDenied(operation, label) {
  let denied = false;
  try { await operation(); }
  catch (error) { denied = [401, 403, 404].includes(Number(error?.code)); }
  if (!denied) throw new Error(`${label} was not denied.`);
}

async function entitlement(tables, userId, portalId) {
  const rows = await tables.listRows({
    databaseId,
    tableId: 'portal_entitlements',
    queries: [Query.equal('userId', [userId]), Query.equal('portalId', [portalId]), Query.equal('status', ['active']), Query.limit(10)],
  });
  if (rows.total !== 1) throw new Error(`${userId} must have exactly one active ${portalId} portal entitlement; found ${rows.total}.`);
  return rows.rows[0];
}

async function membership(tables, userId, expectedRole) {
  const rows = await tables.listRows({
    databaseId,
    tableId: 'agency_memberships',
    queries: [Query.equal('userId', [userId]), Query.equal('agencyId', ['dev_agency']), Query.limit(10)],
  });
  if (rows.total !== 1 || rows.rows[0].role !== expectedRole || rows.rows[0].status !== 'active') {
    throw new Error(`${userId} agency membership did not resolve to active role ${expectedRole}.`);
  }
}

const personas = [
  { name: 'Admin', userId: 'dev_admin', role: 'proinspect_admin', portalId: 'admin' },
  { name: 'Inspector', userId: 'dev_inspector', role: 'inspector', portalId: 'inspector' },
  { name: 'Building Management', userId: 'dev_building_manager', role: 'building_manager', portalId: 'building' },
  { name: 'Strata', userId: 'dev_strata_manager', role: 'strata_manager', portalId: 'strata' },
  { name: 'Resident', userId: 'dev_resident_tenant', role: 'resident_tenant', portalId: 'resident' },
  { name: 'Client', userId: 'dev_client_user', role: 'client_user', portalId: 'client' },
  { name: 'Contractor', userId: 'dev_contractor', role: 'contractor_worker', portalId: 'contractor' },
];

const services = {};
const results = [];
for (const persona of personas) {
  const session = await authenticate(persona.userId);
  const tables = tablesFor(session);
  services[persona.portalId] = tables;
  await membership(tables, persona.userId, persona.role);
  const portal = await entitlement(tables, persona.userId, persona.portalId);
  results.push({ persona: persona.name, userId: persona.userId, portalId: persona.portalId, entitlementId: portal.$id });
}

await expectRow(services.admin, 'agencies', 'dev_agency', 'Admin agency access');
await expectRow(services.admin, 'service_requests', 'dev_service_request', 'Admin service request access');

await expectRow(services.inspector, 'inspection_jobs', 'dev_inspection_job', 'Inspector assigned job access');
await expectDenied(() => services.inspector.getRow({ databaseId, tableId: 'incidents', rowId: 'dev_incident' }), 'Inspector incident access');

await expectRow(services.building, 'managed_sites', 'dev_site_strata', 'Building Manager site access');
await expectRow(services.building, 'incidents', 'dev_incident', 'Building Manager incident access');
await expectRow(services.building, 'maintenance_items', 'dev_maintenance_item', 'Building Manager maintenance access');
await expectDenied(() => services.building.getRow({ databaseId, tableId: 'managed_sites', rowId: 'dev_site_commercial' }), 'Building Manager cross-site access');

await expectRow(services.strata, 'managed_sites', 'dev_site_strata', 'Strata site access');
await expectRow(services.strata, 'incidents', 'dev_incident', 'Strata incident access');
await expectRow(services.strata, 'maintenance_items', 'dev_maintenance_item', 'Strata maintenance access');
await expectDenied(() => services.strata.getRow({ databaseId, tableId: 'managed_sites', rowId: 'dev_site_commercial' }), 'Strata cross-site access');

const residentEntitlement = await entitlement(services.resident, 'dev_resident_tenant', 'resident');
if (residentEntitlement.managedSiteId !== 'dev_site_strata' || residentEntitlement.propertyId !== 'dev_property_unit_1' || residentEntitlement.unitId !== 'dev_unit_1') {
  throw new Error('Resident entitlement does not carry the expected site/property/unit scope.');
}
const residentOccupancies = await services.resident.listRows({
  databaseId, tableId: 'occupancies', queries: [Query.equal('userId', ['dev_resident_tenant']), Query.equal('current', [true]), Query.limit(10)],
});
if (!residentOccupancies.rows.some((row) => row.$id === 'dev_occupancy_tenant')) throw new Error('Resident occupancy resolution failed.');
await expectRow(services.resident, 'units', 'dev_unit_1', 'Resident unit access');
await expectRow(services.resident, 'resident_requests', 'dev_resident_request', 'Resident own request access');
await expectDenied(() => services.resident.getRow({ databaseId, tableId: 'incidents', rowId: 'dev_incident' }), 'Resident incident access');

const clientEntitlement = await entitlement(services.client, 'dev_client_user', 'client');
if (clientEntitlement.clientAccountId !== 'dev_client' || clientEntitlement.propertyId !== 'dev_property_unit_1') {
  throw new Error('Client entitlement does not carry the expected client/property scope.');
}
await expectRow(services.client, 'clients', 'dev_client', 'Client account access');
await expectRow(services.client, 'property_client_relationships', 'dev_property_client', 'Client property relationship access');
await expectRow(services.client, 'properties', 'dev_property_unit_1', 'Client property access');
await expectRow(services.client, 'service_requests', 'dev_service_request', 'Client service request access');
await expectDenied(() => services.client.getRow({ databaseId, tableId: 'incidents', rowId: 'dev_incident' }), 'Client incident access');

const contractorEntitlement = await entitlement(services.contractor, 'dev_contractor', 'contractor');
if (contractorEntitlement.contractorId !== 'dev_contractor_profile' || contractorEntitlement.managedSiteId !== 'dev_site_strata') {
  throw new Error('Contractor entitlement does not carry the expected contractor/site scope.');
}
await expectRow(services.contractor, 'contractors', 'dev_contractor_profile', 'Contractor company access');
await expectRow(services.contractor, 'maintenance_work_orders', 'dev_work_order', 'Contractor assigned work access');
await expectDenied(() => services.contractor.getRow({ databaseId, tableId: 'incidents', rowId: 'dev_incident' }), 'Contractor incident access');

console.log('Seven-portal Appwrite Development persona acceptance passed:');
for (const result of results) console.log(`- ${result.persona}: ${result.userId} -> ${result.portalId} (${result.entitlementId})`);