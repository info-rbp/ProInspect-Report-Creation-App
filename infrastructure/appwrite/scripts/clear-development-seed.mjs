import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, TablesDB, Users } from 'node-appwrite';
import { assertDevelopmentTarget } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.APPWRITE_ENVIRONMENT !== 'development') throw new Error('APPWRITE_ENVIRONMENT must equal development.');
const target = assertDevelopmentTarget({projectId:process.env.APPWRITE_PROJECT_ID,projectName:process.env.APPWRITE_PROJECT_NAME,endpoint:process.env.APPWRITE_ENDPOINT}, process.env.APPWRITE_CONFIRM_CLEAR);
if (!process.env.APPWRITE_API_KEY) throw new Error('APPWRITE_API_KEY is required.');
const seed = JSON.parse(await readFile(resolve(root, 'seeds/development.json'), 'utf8'));
const client = new Client().setEndpoint(target.endpoint).setProject(target.projectId).setKey(process.env.APPWRITE_API_KEY);
const tables = new TablesDB(client); const users = new Users(client); const databaseId = 'proinspect_core';
const deletes = [
  ...seed.operationalRecords.map(({tableId,row}) => [tableId,row.$id]),
  ...seed.siteMemberships.map((item) => ['site_memberships',item.$id]),
  ...seed.identities.flatMap(([userId]) => [['agency_memberships',`${userId}_agency`],['user_profiles',userId]]),
  ...seed.serviceDefinitions.map((item) => ['service_definitions',item.$id]),
  ...seed.properties.map((item) => ['properties',item.$id]),
  ...seed.sites.map((item) => ['managed_sites',item.$id]),
  ['agencies',seed.agency.$id],
];
for (const [tableId,rowId] of deletes) { try { await tables.deleteRow({databaseId,tableId,rowId}); } catch (error) { if (error?.code !== 404) throw error; } }
for (const [userId] of seed.identities) { try { await users.delete({userId}); } catch (error) { if (error?.code !== 404) throw error; } }
console.log('Removed only the fixed synthetic Development seed records and identities.');
