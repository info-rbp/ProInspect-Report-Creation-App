import { Client, Query, Storage, TablesDB, Teams } from 'node-appwrite';
import { tables as expectedTables } from '../tables/schema.mjs';
import databases from '../databases/databases.json' with { type: 'json' };
import buckets from '../buckets/buckets.json' with { type: 'json' };
import teamsConfig from '../teams/teams.json' with { type: 'json' };
import { assertDevelopmentTarget } from './safety.mjs';

const target = assertDevelopmentTarget({projectId:process.env.APPWRITE_PROJECT_ID,projectName:process.env.APPWRITE_PROJECT_NAME,endpoint:process.env.APPWRITE_ENDPOINT}, process.env.APPWRITE_CONFIRM_VERIFY);
if (!process.env.APPWRITE_API_KEY) throw new Error('APPWRITE_API_KEY is required for schema verification.');
const client = new Client().setEndpoint(target.endpoint).setProject(target.projectId).setKey(process.env.APPWRITE_API_KEY);
const tables = new TablesDB(client);
const storage = new Storage(client);
const teams = new Teams(client);
const remoteDatabases = await tables.list({ queries: [Query.limit(100)] });
const remoteTables = await tables.listTables({ databaseId: 'proinspect_core', queries: [Query.limit(100)] });
const remoteBuckets = await storage.listBuckets({ queries: [Query.limit(100)] });
const remoteTeams = await teams.list({ queries: [Query.limit(100)] });
const errors = [];
const compareIds = (label, expected, actual) => {
  const expectedIds = new Set(expected.map((item) => item.$id));
  const actualIds = new Set(actual.map((item) => item.$id));
  for (const id of expectedIds) if (!actualIds.has(id)) errors.push(`${label} ${id} is missing remotely.`);
  for (const id of actualIds) if (!expectedIds.has(id)) errors.push(`${label} ${id} exists remotely but is not source-controlled.`);
};

compareIds('Database', databases, remoteDatabases.databases);
compareIds('Table', expectedTables, remoteTables.tables);
compareIds('Bucket', buckets, remoteBuckets.buckets);
compareIds('Team', teamsConfig, remoteTeams.teams);
const missingTables = expectedTables.filter((expected) => !remoteTables.tables.some((actual) => actual.$id === expected.$id)).map((item) => item.$id);
const missingBuckets = buckets.filter((expected) => !remoteBuckets.buckets.some((actual) => actual.$id === expected.$id)).map((item) => item.$id);
const missingTeams = teamsConfig.filter((expected) => !remoteTeams.teams.some((actual) => actual.$id === expected.$id)).map((item) => item.$id);
if (missingTables.length || missingBuckets.length || missingTeams.length) errors.push(`Remote foundation incomplete. Missing tables: ${missingTables.join(', ') || 'none'}; buckets: ${missingBuckets.join(', ') || 'none'}; teams: ${missingTeams.join(', ') || 'none'}.`);

for (const expected of databases) {
  const actual = remoteDatabases.databases.find((item) => item.$id === expected.$id);
  if (actual && (actual.name !== expected.name || actual.enabled !== expected.enabled)) errors.push(`${expected.$id} database settings differ.`);
}

function columnDiffers(expected, actual) {
  if (actual.status !== 'available' || actual.type !== expected.type || actual.required !== expected.required || Boolean(actual.array) !== Boolean(expected.array)) return true;
  if ('format' in expected && actual.format !== expected.format) return true;
  if ('size' in expected && !('format' in expected) && actual.size !== expected.size) return true;
  if ('elements' in expected && JSON.stringify(actual.elements) !== JSON.stringify(expected.elements)) return true;
  if ('default' in expected && actual.default !== expected.default) return true;
  if ('min' in expected && actual.min !== expected.min) return true;
  if ('max' in expected && actual.max !== expected.max) return true;
  for (const key of ['relatedTable', 'relationType', 'twoWay', 'twoWayKey', 'onDelete', 'side']) {
    if (key in expected && actual[key] !== expected[key]) return true;
  }
  return false;
}

let columnCount = 0;
let indexCount = 0;
for (const expected of expectedTables) {
  const actual = remoteTables.tables.find((item) => item.$id === expected.$id);
  if (!actual) continue;
  if (actual.name !== expected.name || actual.rowSecurity !== expected.rowSecurity || actual.enabled !== expected.enabled || JSON.stringify(actual.$permissions) !== JSON.stringify(expected.$permissions)) errors.push(`${expected.$id} table security/settings differ.`);
  const [remoteColumns, remoteIndexes] = await Promise.all([
    tables.listColumns({ databaseId: 'proinspect_core', tableId: expected.$id, queries: [Query.limit(100)] }),
    tables.listIndexes({ databaseId: 'proinspect_core', tableId: expected.$id, queries: [Query.limit(100)] }),
  ]);
  columnCount += remoteColumns.columns.length;
  indexCount += remoteIndexes.indexes.length;
  const expectedColumnKeys = new Set(expected.columns.map((item) => item.key));
  const expectedIndexKeys = new Set(expected.indexes.map((item) => item.key));
  for (const remote of remoteColumns.columns) if (!expectedColumnKeys.has(remote.key)) errors.push(`${expected.$id}.${remote.key} column exists remotely but is not source-controlled.`);
  for (const remote of remoteIndexes.indexes) if (!expectedIndexKeys.has(remote.key)) errors.push(`${expected.$id}.${remote.key} index exists remotely but is not source-controlled.`);
  for (const column of expected.columns) {
    const remote = remoteColumns.columns.find((item) => item.key === column.key);
    if (!remote) errors.push(`${expected.$id}.${column.key} column is missing.`);
    else if (columnDiffers(column, remote)) {
      errors.push(`${expected.$id}.${column.key} column definition/status differs.`);
    }
  }
  for (const item of expected.indexes) {
    const remote = remoteIndexes.indexes.find((candidate) => candidate.key === item.key);
    if (!remote) errors.push(`${expected.$id}.${item.key} index is missing.`);
    else if (remote.status !== 'available' || remote.type !== item.type || JSON.stringify(remote.columns) !== JSON.stringify(item.columns) || JSON.stringify(remote.orders ?? []) !== JSON.stringify(item.orders ?? [])) {
      errors.push(`${expected.$id}.${item.key} index definition/status differs.`);
    }
  }
}

for (const expected of buckets) {
  const actual = remoteBuckets.buckets.find((item) => item.$id === expected.$id);
  if (!actual) continue;
  if (actual.name !== expected.name || JSON.stringify(actual.$permissions) !== JSON.stringify(expected.$permissions) || actual.fileSecurity !== expected.fileSecurity || actual.enabled !== expected.enabled || actual.encryption !== expected.encryption || actual.antivirus !== expected.antivirus || actual.maximumFileSize !== expected.maximumFileSize || actual.compression !== expected.compression || JSON.stringify(actual.allowedFileExtensions) !== JSON.stringify(expected.allowedFileExtensions)) {
    errors.push(`${expected.$id} bucket security/settings differ.`);
  }
}
for (const expected of teamsConfig) {
  const actual = remoteTeams.teams.find((item) => item.$id === expected.$id);
  if (actual && actual.name !== expected.name) errors.push(`${expected.$id} team settings differ.`);
}
if (errors.length) throw new Error(`Remote schema verification failed:\n${errors.map((item) => `- ${item}`).join('\n')}`);
console.log(`Verified ${databases.length} database, ${expectedTables.length} tables (${columnCount} columns, ${indexCount} indexes), ${buckets.length} buckets, and ${teamsConfig.length} teams in Development with no drift in either direction.`);
