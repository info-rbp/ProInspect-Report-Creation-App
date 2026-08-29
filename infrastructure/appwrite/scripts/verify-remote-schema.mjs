import { Client, Query, Storage, TablesDB, Teams } from 'node-appwrite';
import { tables as expectedTables } from '../tables/schema.mjs';
import buckets from '../buckets/buckets.json' with { type: 'json' };
import teamsConfig from '../teams/teams.json' with { type: 'json' };
import { assertDevelopmentTarget } from './safety.mjs';

const target = assertDevelopmentTarget({projectId:process.env.APPWRITE_PROJECT_ID,projectName:process.env.APPWRITE_PROJECT_NAME,endpoint:process.env.APPWRITE_ENDPOINT}, process.env.APPWRITE_CONFIRM_VERIFY);
if (!process.env.APPWRITE_API_KEY) throw new Error('APPWRITE_API_KEY is required for schema verification.');
const client = new Client().setEndpoint(target.endpoint).setProject(target.projectId).setKey(process.env.APPWRITE_API_KEY);
const tables = new TablesDB(client);
const storage = new Storage(client);
const teams = new Teams(client);
const remoteTables = await tables.listTables({ databaseId: 'proinspect_core', queries: [Query.limit(100)] });
const remoteBuckets = await storage.listBuckets({ queries: [Query.limit(100)] });
const remoteTeams = await teams.list({ queries: [Query.limit(100)] });
const missingTables = expectedTables.filter((expected) => !remoteTables.tables.some((actual) => actual.$id === expected.$id)).map((item) => item.$id);
const missingBuckets = buckets.filter((expected) => !remoteBuckets.buckets.some((actual) => actual.$id === expected.$id)).map((item) => item.$id);
const missingTeams = teamsConfig.filter((expected) => !remoteTeams.teams.some((actual) => actual.$id === expected.$id)).map((item) => item.$id);
if (missingTables.length || missingBuckets.length || missingTeams.length) {
  throw new Error(`Remote foundation incomplete. Missing tables: ${missingTables.join(', ') || 'none'}; buckets: ${missingBuckets.join(', ') || 'none'}; teams: ${missingTeams.join(', ') || 'none'}.`);
}

const errors = [];
let columnCount = 0;
let indexCount = 0;
for (const expected of expectedTables) {
  const actual = remoteTables.tables.find((item) => item.$id === expected.$id);
  if (actual.rowSecurity !== true || actual.enabled !== true || actual.$permissions.length !== 0) errors.push(`${expected.$id} table security/settings differ.`);
  const [remoteColumns, remoteIndexes] = await Promise.all([
    tables.listColumns({ databaseId: 'proinspect_core', tableId: expected.$id, queries: [Query.limit(100)] }),
    tables.listIndexes({ databaseId: 'proinspect_core', tableId: expected.$id, queries: [Query.limit(100)] }),
  ]);
  columnCount += remoteColumns.columns.length;
  indexCount += remoteIndexes.indexes.length;
  for (const column of expected.columns) {
    const remote = remoteColumns.columns.find((item) => item.key === column.key);
    if (!remote) errors.push(`${expected.$id}.${column.key} column is missing.`);
    else if (remote.status !== 'available' || remote.type !== column.type || remote.required !== column.required || ('format' in column ? remote.format !== column.format : ('size' in column && remote.size !== column.size))) {
      errors.push(`${expected.$id}.${column.key} column definition/status differs.`);
    }
  }
  for (const item of expected.indexes) {
    const remote = remoteIndexes.indexes.find((candidate) => candidate.key === item.key);
    if (!remote) errors.push(`${expected.$id}.${item.key} index is missing.`);
    else if (remote.status !== 'available' || remote.type !== item.type || JSON.stringify(remote.columns) !== JSON.stringify(item.columns)) {
      errors.push(`${expected.$id}.${item.key} index definition/status differs.`);
    }
  }
}

for (const expected of buckets) {
  const actual = remoteBuckets.buckets.find((item) => item.$id === expected.$id);
  if (actual.$permissions.length !== 0 || actual.fileSecurity !== true || actual.enabled !== expected.enabled || actual.encryption !== true || actual.antivirus !== true || actual.maximumFileSize !== expected.maximumFileSize) {
    errors.push(`${expected.$id} bucket security/settings differ.`);
  }
}
if (errors.length) throw new Error(`Remote schema verification failed:\n${errors.map((item) => `- ${item}`).join('\n')}`);
console.log(`Verified ${expectedTables.length} tables (${columnCount} columns, ${indexCount} indexes), ${buckets.length} buckets, and ${teamsConfig.length} teams in Development.`);
