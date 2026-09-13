import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { root, readJson, canonical, requireThat } from '../runtime.mjs';
import { optional, paged } from '../appwrite-session.mjs';

export async function sourceSchema() {
  const directory = resolve(root, 'infrastructure/appwrite');
  const a = await import(pathToFileURL(resolve(directory,'tables/schema.mjs')).href);
  const b = await import(pathToFileURL(resolve(directory,'tables/unified-platform-extensions.mjs')).href);
  return { databases: readJson(resolve(directory,'databases/databases.json')), tables: [...a.tables,...b.unifiedPlatformExtensionTables], buckets: readJson(resolve(directory,'buckets/buckets.json')), teams: readJson(resolve(directory,'teams/teams.json')) };
}
const columnFields = ['type','required','array','format','size','elements','default','min','max'];
export function columnChanges(expected, actual) {
  return columnFields.filter((key) => Object.hasOwn(expected,key) && !(key === 'size' && expected.format) && canonical(expected[key]) !== canonical(actual[key]));
}
export async function ensureSchema(api, schema, databaseId) {
  const { db, storage, Query } = api;
  const wantedDatabase=schema.databases?.find((d)=>d.$id===databaseId);requireThat(wantedDatabase,'Source database definition is missing');
  const database = await optional(() => db.get({ databaseId }));
  if (!database) await db.create({ databaseId, name: wantedDatabase.name ?? databaseId, enabled: wantedDatabase.enabled ?? true });
  else requireThat(database.name===wantedDatabase.name && database.enabled===wantedDatabase.enabled,'Existing database definition differs from source');
  for (const table of schema.tables) {
    requireThat(table.rowSecurity === true && table.$permissions?.length === 0, 'Unsafe source table permissions');
    const common = { databaseId, tableId: table.$id };
    const existing = await optional(() => db.getTable(common));
    if (!existing) await db.createTable({ ...common, name: table.name, permissions: [], rowSecurity: true, enabled: true });
    else requireThat(existing.name===table.name && existing.rowSecurity===table.rowSecurity && existing.enabled===table.enabled && canonical(existing.$permissions ?? [])===canonical(table.$permissions ?? []), `Existing table definition differs from source: ${table.$id}`);
    const columns = await paged((queries) => db.listColumns({ ...common, queries }), 'columns', Query);
    for (const actual of columns) requireThat(table.columns.some((c) => c.key === actual.key), `Destructive column removal blocked: ${table.$id}.${actual.key}`);
    for (const column of table.columns) {
      const live = columns.find((c) => c.key === column.key);
      if (live) { requireThat(!columnChanges(column, live).length, `In-place column change blocked: ${table.$id}.${column.key}`); continue; }
      const kind = column.format || column.type;
      const methods = { string:'createStringColumn', varchar:'createVarcharColumn', integer:'createIntegerColumn', double:'createFloatColumn', boolean:'createBooleanColumn', datetime:'createDatetimeColumn', email:'createEmailColumn', url:'createUrlColumn', ip:'createIpColumn', enum:'createEnumColumn' };
      const method = methods[kind]; requireThat(method && typeof db[method] === 'function', `Unsupported column type: ${kind}`);
      const values = { ...column }; delete values.type; delete values.format;
      if (column.format) delete values.size;
      await db[method]({ ...common, ...values });
    }
    for (let attempt = 0; ; attempt++) {
      const values = await paged((queries) => db.listColumns({ ...common, queries }), 'columns', Query);
      requireThat(!values.some((c) => ['failed','stuck'].includes(c.status)), 'Column creation failed');
      if (values.length === table.columns.length && values.every((c) => c.status === 'available')) break;
      requireThat(attempt < 120, 'Column readiness timeout'); await delay(1000);
    }
    const indexes = await paged((queries) => db.listIndexes({ ...common, queries }), 'indexes', Query);
    for (const live of indexes) requireThat(table.indexes.some((i) => i.key === live.key), `Destructive index removal blocked: ${table.$id}.${live.key}`);
    for (const index of table.indexes) {
      const live = indexes.find((i) => i.key === index.key);
      if (!live) await db.createIndex({ ...common, ...index });
      else requireThat(['type','columns','orders'].every((k) => canonical(live[k] ?? []) === canonical(index[k] ?? [])), `Index change blocked: ${index.key}`);
    }
    for (let attempt = 0; ; attempt++) {
      const values = await paged((queries) => db.listIndexes({ ...common, queries }), 'indexes', Query);
      if (values.length === table.indexes.length && values.every((i) => i.status === 'available')) break;
      requireThat(attempt < 120 && !values.some((i) => i.status === 'failed'), 'Index readiness failed'); await delay(1000);
    }
  }
  for (const bucket of schema.buckets) {
    requireThat(bucket.fileSecurity && bucket.$permissions?.length === 0, 'Unsafe source bucket');
    const existing = await optional(() => storage.getBucket({ bucketId: bucket.$id }));
    if (!existing) { const data = { ...bucket, bucketId: bucket.$id, permissions: bucket.$permissions }; delete data.$id; delete data.$permissions; await storage.createBucket(data); }
    else for (const key of ['name','fileSecurity','$permissions','enabled','encryption','antivirus','maximumFileSize','allowedFileExtensions','compression']) requireThat(canonical(existing[key]) === canonical(bucket[key]), `Bucket drift requires review: ${bucket.$id}.${key}`);
  }
  for (const team of schema.teams ?? []) {
    const live = await optional(() => api.teams.get({teamId:team.$id}));
    if (!live) await api.teams.create({teamId:team.$id,name:team.name});
    else requireThat(live.name === team.name, 'Team definition drift');
  }
  return { tables: schema.tables.length, buckets: schema.buckets.length };
}
