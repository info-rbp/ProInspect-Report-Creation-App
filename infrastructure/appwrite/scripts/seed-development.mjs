import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Permission, Role, TablesDB, Users } from 'node-appwrite';
import { assertDevelopmentTarget } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = assertDevelopmentTarget({projectId:process.env.APPWRITE_PROJECT_ID,projectName:process.env.APPWRITE_PROJECT_NAME,endpoint:process.env.APPWRITE_ENDPOINT}, process.env.APPWRITE_CONFIRM_SEED);
if (!process.env.APPWRITE_API_KEY || !process.env.APPWRITE_SEED_PASSWORD) throw new Error('APPWRITE_API_KEY and APPWRITE_SEED_PASSWORD are required.');
const seed = JSON.parse(await readFile(resolve(root, 'seeds/development.json'), 'utf8'));
const client = new Client().setEndpoint(target.endpoint).setProject(target.projectId).setKey(process.env.APPWRITE_API_KEY);
const tables = new TablesDB(client);
const users = new Users(client);
const now = new Date().toISOString();
const databaseId = 'proinspect_core';
const allUserIds = seed.identities.map(([userId]) => userId);
const readForUsers = (userIds) => [...new Set(userIds)].map((userId) => Permission.read(Role.user(userId)));
const siteReaders = (siteId) => ['dev_admin', ...seed.siteMemberships.filter((item) => item.managedSiteId === siteId).map((item) => item.userId)];

async function upsert(tableId, item, permissions = [], agencyScoped = true) {
  const data = { ...item, ...(agencyScoped ? { agencyId: item.agencyId ?? seed.agency.$id } : {}), createdAt: item.createdAt ?? now, updatedAt: now };
  const rowId = data.$id;
  delete data.$id;
  try { await tables.getRow({ databaseId, tableId, rowId }); await tables.updateRow({ databaseId, tableId, rowId, data, permissions }); }
  catch (error) { if (error?.code !== 404) throw error; await tables.createRow({ databaseId, tableId, rowId, data, permissions }); }
}

const agency = { ...seed.agency }; delete agency.agencyId;
await upsert('agencies', agency, readForUsers(allUserIds), false);
for (const site of seed.sites) await upsert('managed_sites', site, readForUsers(siteReaders(site.$id)));
for (const clientRecord of seed.clients ?? []) await upsert('clients', clientRecord, readForUsers(['dev_admin', 'dev_client_user']));
for (const property of seed.properties) {
  const readers = property.managedSiteId ? siteReaders(property.managedSiteId) : ['dev_admin', 'dev_client_user'];
  await upsert('properties', property, readForUsers(readers));
}
for (const unit of seed.units ?? []) await upsert('units', unit, readForUsers(['dev_admin', 'dev_building_manager', 'dev_relief_manager', 'dev_strata_manager', 'dev_council_member', 'dev_resident_owner', 'dev_resident_tenant', 'dev_client_user']));
for (const occupancy of seed.occupancies ?? []) await upsert('occupancies', occupancy, readForUsers(['dev_admin', 'dev_building_manager', 'dev_relief_manager', 'dev_strata_manager', 'dev_resident_owner', 'dev_resident_tenant']));
for (const contractor of seed.contractors ?? []) await upsert('contractors', contractor, readForUsers(['dev_admin', 'dev_building_manager', 'dev_relief_manager', 'dev_strata_manager', 'dev_contractor']));
for (const relationship of seed.propertyClientRelationships ?? []) await upsert('property_client_relationships', relationship, readForUsers(['dev_admin', 'dev_client_user']));
for (const definition of seed.serviceDefinitions) await upsert('service_definitions', definition, readForUsers(allUserIds));
for (const [userId, role] of seed.identities) {
  const email = `${userId}@example.com`;
  let exists = true;
  try { await users.get({ userId }); }
  catch (error) { if (error?.code !== 404) throw error; exists = false; await users.create({ userId, email, password: process.env.APPWRITE_SEED_PASSWORD, name: `DEV TEST - ${role}` }); }
  if (exists) await users.updatePassword({ userId, password: process.env.APPWRITE_SEED_PASSWORD });
  const read = [Permission.read(Role.user(userId))];
  await upsert('user_profiles', {$id:userId,userId,displayName:`DEV TEST - ${role}`,email,status:'active'}, read, false);
  await upsert('agency_memberships', {$id:`${userId}_agency`,userId,role,status:'active',mfaRequired:['proinspect_admin','reviewer'].includes(role)}, read);
}
for (const membership of seed.siteMemberships) await upsert('site_memberships', membership, readForUsers([membership.userId]));
for (const entitlement of seed.portalEntitlements ?? []) await upsert('portal_entitlements', entitlement, readForUsers([entitlement.userId]));
const operationalReaders = {
  service_requests: ['dev_admin', 'dev_building_manager', 'dev_inspector', 'dev_client_user'],
  inspection_jobs: ['dev_admin', 'dev_inspector', 'dev_client_user', 'dev_resident_tenant'],
  maintenance_items: ['dev_admin', 'dev_building_manager', 'dev_strata_manager', 'dev_client_user'],
  maintenance_work_orders: ['dev_admin', 'dev_building_manager', 'dev_contractor'],
  incidents: ['dev_admin', 'dev_building_manager', 'dev_strata_manager'],
  resident_requests: ['dev_admin', 'dev_building_manager', 'dev_strata_manager', 'dev_resident_tenant'],
};
for (const { tableId, row } of seed.operationalRecords) await upsert(tableId, row, readForUsers(operationalReaders[tableId] ?? ['dev_admin']));
console.log(`Seeded synthetic Development foundation data for ${seed.identities.length} identities, ${seed.siteMemberships.length} site memberships and ${(seed.portalEntitlements ?? []).length} portal entitlements.`);