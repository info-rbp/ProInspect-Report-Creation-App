import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acceptance } from '../adapter-sdk.mjs';
import { root, run, readJson, canonical, requireThat, manifest } from '../runtime.mjs';
import { appwriteAudit } from '../providers.mjs';

function compareIds(label, expected, actual, errors) {
  const left = expected.map((v) => v.$id).sort(); const right = actual.map((v) => v.$id).sort();
  if (new Set(left).size !== left.length || new Set(right).size !== right.length || canonical(left) !== canonical(right)) errors.push(`${label}: missing, duplicate or extra IDs`);
}
function fields(label, expected, actual, names, errors) {
  if (!actual) { errors.push(`${label}: missing`); return; }
  for (const name of names) if (Object.hasOwn(expected, name) && canonical(actual[name]) !== canonical(expected[name])) errors.push(`${label}.${name}: differs`);
}
export function compareSchema(expected, actual) {
  const errors = []; const unavailable = [];
  for (const type of ['databases', 'tables', 'buckets', 'teams']) compareIds(type, expected[type], actual[type], errors);
  for (const value of expected.databases) fields(value.$id, value, actual.databases.find((a) => a.$id === value.$id), ['name', 'enabled'], errors);
  for (const table of expected.tables) {
    const remote = actual.tables.find((a) => a.$id === table.$id);
    fields(table.$id, table, remote, ['name', 'enabled', 'rowSecurity', '$permissions'], errors);
    if (!remote) continue;
    for (const [kind, keys] of [['columns', ['type', 'required', 'array', 'format', 'size', 'elements', 'default', 'min', 'max', 'relatedTable', 'relationType', 'twoWay', 'twoWayKey', 'onDelete', 'side']], ['indexes', ['type', 'columns', 'orders']]]) {
      const wanted = table[kind] ?? []; const found = remote[kind] ?? [];
      const a = wanted.map((v) => v.key).sort(); const b = found.map((v) => v.key).sort();
      if (canonical(a) !== canonical(b) || new Set(b).size !== b.length) errors.push(`${table.$id}.${kind}: missing, duplicate or extra keys`);
      for (const value of wanted) {
        const live = found.find((v) => v.key === value.key);
        // Appwrite formatted strings can report a provider-defined size.
        const applicable = kind === 'columns' && value.format ? keys.filter((key) => key !== 'size') : keys;
        fields(`${table.$id}.${value.key}`, value, live, applicable, errors);
        if (live?.status !== 'available') unavailable.push(`${table.$id}.${value.key}`);
      }
    }
  }
  for (const bucket of expected.buckets) fields(bucket.$id, bucket, actual.buckets.find((a) => a.$id === bucket.$id), ['name', '$permissions', 'fileSecurity', 'enabled', 'encryption', 'antivirus', 'maximumFileSize', 'compression', 'allowedFileExtensions'], errors);
  for (const team of expected.teams) fields(team.$id, team, actual.teams.find((a) => a.$id === team.$id), ['name'], errors);
  return { errors, unavailable };
}
export async function verifyAppwrite() {
  const session = acceptance(); const { input } = session; const target = input.target.appwrite;
  requireThat(!process.env.APPWRITE_API_KEY, 'API keys are prohibited by this CLI verifier.');
  const actualVersion = await run('appwrite', ['--version'], { quiet: true, timeoutMs: 30_000 });
  requireThat(actualVersion.match(/\d+\.\d+\.\d+/u)?.[0] === '27.2.1', 'Appwrite CLI 27.2.1 is required.');
  const directory = dirname(process.env.PROINSPECT_LAUNCH_OUTPUT);
  const identity = await appwriteAudit(target, directory);
  const cwd = resolve(directory, 'appwrite-context');
  const json = async (args) => JSON.parse(await run('appwrite', ['--json', ...args], { cwd, live: true, quiet: true, timeoutMs: 90_000 }));
  const list = async (args, key) => {
    const value = await json(args);
    requireThat(Array.isArray(value[key]) && value.total === value[key].length, `Truncated or invalid Appwrite ${key} response. Increase bounded pagination after review.`);
    return value[key];
  };
  const schemaRoot = resolve(root, 'infrastructure/appwrite');
  const foundation = await import(pathToFileURL(resolve(schemaRoot, 'tables/schema.mjs')).href);
  const extensions = await import(pathToFileURL(resolve(schemaRoot, 'tables/unified-platform-extensions.mjs')).href);
  const expected = {
    databases: readJson(resolve(schemaRoot, 'databases/databases.json')),
    tables: [...foundation.tables, ...extensions.unifiedPlatformExtensionTables],
    buckets: readJson(resolve(schemaRoot, 'buckets/buckets.json')),
    teams: readJson(resolve(schemaRoot, 'teams/teams.json')),
  };
  requireThat(expected.tables.length === manifest.targetSchemaTables && new Set(expected.tables.map((v) => v.$id)).size === expected.tables.length, 'Canonical table count/uniqueness differs from the reviewed installer.');
  const actual = {
    databases: await list(['tablesdb', 'list', '--limit', '100'], 'databases'),
    tables: await list(['tablesdb', 'list-tables', '--database-id', target.databaseId, '--limit', '500'], 'tables'),
    buckets: await list(['storage', 'list-buckets', '--limit', '100'], 'buckets'),
    teams: await list(['teams', 'list', '--limit', '100'], 'teams'),
  };
  for (const table of actual.tables) {
    table.columns = await list(['tablesdb', 'list-columns', '--database-id', target.databaseId, '--table-id', table.$id, '--limit', '500'], 'columns');
    table.indexes = await list(['tablesdb', 'list-indexes', '--database-id', target.databaseId, '--table-id', table.$id, '--limit', '500'], 'indexes');
  }
  const keys = await json(['project', 'list-keys', '--limit', '100']);
  const platforms = await list(['project', 'list-platforms', '--project-id', target.projectId, '--limit', '100'], 'platforms');
  const differences = compareSchema(expected, actual);
  session.check('exact_project_identity', identity.projectId, target.projectId);
  session.check('schema_bidirectional', differences.errors, []);
  session.check('indexes_available', differences.unavailable, []);
  session.check('bucket_permissions', actual.buckets.length === 7 && actual.buckets.every((b) => b.enabled && b.fileSecurity && b.encryption && b.antivirus && b.$permissions?.length === 0), true);
  session.check('least_privilege', actual.tables.every((t) => t.rowSecurity === true && t.$permissions?.length === 0), true);
  session.check('no_unapproved_keys', keys.total, 0);
  const host = new URL(input.target.web.origin).hostname;
  session.check('registered_domains', platforms.some((p) => p.type === 'web' && p.hostname === host), true);
  session.artifact('schema-verification.json', JSON.stringify({ identity, tables: actual.tables.length, columns: actual.tables.reduce((n, t) => n + t.columns.length, 0), indexes: actual.tables.reduce((n, t) => n + t.indexes.length, 0), buckets: actual.buckets.length, keys: keys.total, registeredHost: host, differences }, null, 2));
  session.finish();
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await verifyAppwrite(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
