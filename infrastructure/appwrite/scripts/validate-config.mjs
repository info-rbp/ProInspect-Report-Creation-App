import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tables } from '../tables/schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const errors = [];
const config = await readJson('appwrite.config.json');
const generatedTables = await readJson('tables/tables.json');
const buckets = await readJson('buckets/buckets.json');

if (config.projectId !== 'DEVELOPMENT_PROJECT_ID_REQUIRED') errors.push('Version-controlled config must retain the non-deployable Development project placeholder.');
if (!/Development/i.test(config.projectName)) errors.push('Project name must identify Development.');
if (JSON.stringify(generatedTables) !== JSON.stringify(tables)) errors.push('tables/tables.json is stale; run npm run appwrite:generate.');

const ids = new Set();
for (const table of tables) {
  if (ids.has(table.$id)) errors.push(`Duplicate table ID: ${table.$id}`);
  ids.add(table.$id);
  if (table.$id.length > 36) errors.push(`Table ID exceeds 36 characters: ${table.$id}`);
  if (table.databaseId !== 'proinspect_core') errors.push(`${table.$id} targets an unexpected database.`);
  if (table.rowSecurity !== true || table.$permissions.length !== 0) errors.push(`${table.$id} is not deny-by-default with row security.`);
  const columnIds = new Set(table.columns.map((column) => column.key));
  if (columnIds.size !== table.columns.length) errors.push(`${table.$id} has duplicate columns.`);
  const indexIds = new Set();
  for (const item of table.indexes) {
    if (indexIds.has(item.key)) errors.push(`${table.$id} has duplicate index ID: ${item.key}.`);
    indexIds.add(item.key);
    if (item.key.length > 36) errors.push(`${table.$id}.${item.key} index ID exceeds 36 characters.`);
    for (const column of item.columns) if (!columnIds.has(column)) errors.push(`${table.$id}.${item.key} references missing column ${column}.`);
  }
}

for (const bucket of buckets) {
  if (bucket.$permissions.length !== 0 || bucket.fileSecurity !== true) errors.push(`${bucket.$id} is not deny-by-default with file security.`);
  if (bucket.encryption !== true || bucket.antivirus !== true) errors.push(`${bucket.$id} must enable encryption and antivirus.`);
}

const requiredTables = ['agencies','managed_sites','user_profiles','agency_memberships','site_memberships','properties','service_definitions','service_requests','inspection_jobs','maintenance_items','audit_events','evidence_files','migration_id_map'];
for (const id of requiredTables) if (!ids.has(id)) errors.push(`Required table missing: ${id}`);

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Validated ${tables.length} tables and ${buckets.length} deny-by-default buckets.`);
