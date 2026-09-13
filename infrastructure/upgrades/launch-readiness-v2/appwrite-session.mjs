import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, run, requireThat, manifest, canonical } from './runtime.mjs';
import { requireCommand } from './appwrite-contract.mjs';

export function installerCredentialFromEnvironment(env = process.env) {
  const id = env.APPWRITE_INSTALLER_KEY_ID?.trim();
  const secret = env.APPWRITE_INSTALLER_KEY_SECRET?.trim();
  requireThat(Boolean(id && secret), 'Create a dedicated Appwrite stored installer key and export APPWRITE_INSTALLER_KEY_ID and APPWRITE_INSTALLER_KEY_SECRET; no mutation performed');
  return { id, secret };
}

export function validateInstallerCredential(key, scopes, now = Date.now()) {
  requireThat(key && typeof key === 'object', 'Configured Appwrite installer key was not found; no mutation performed');
  requireThat(/^launch-installer-/u.test(String(key.name ?? '')), 'Installer key must use the launch-installer- name prefix; no mutation performed');
  requireThat(Array.isArray(key.scopes) && canonical([...key.scopes].sort()) === canonical([...scopes].sort()), 'Installer key scopes differ from requested scopes; no mutation performed');
  const expire = Date.parse(key.expire);
  requireThat(Number.isFinite(expire) && expire > now && expire <= now + 3660000, 'Installer key must expire within one hour; no mutation performed');
  return true;
}

export async function appwriteContext(target, directory, execute = run) {
  requireThat(target.endpoint === 'https://syd.cloud.appwrite.io/v1' && !manifest.prohibited.appwriteProjects.includes(target.projectId), 'Unapproved Appwrite target');
  requireThat(!process.env.APPWRITE_API_KEY, 'Unset APPWRITE_API_KEY; installer uses dedicated operator-created credentials');
  const cwd = resolve(directory, 'appwrite-context');
  atomicJson(resolve(cwd, 'appwrite.config.json'), { projectId: target.projectId, projectName: target.projectName, endpoint: target.endpoint });
  const cli = async (args, { secret = false } = {}) => JSON.parse(await execute('appwrite', ['--raw', ...(secret ? ['--show-secrets'] : []), ...args], { cwd, live: true, sensitive: true, timeoutMs: 90000 }));
  const project = await cli(['project','get','--project-id',target.projectId]);
  requireThat(project.$id === target.projectId && project.name === target.projectName && project.status === 'active' && project.region === 'syd', 'Appwrite identity mismatch');
  return { cwd, cli, project };
}

export async function withAppwrite(target, directory, scopes, operation, execute = run, env = process.env) {
  const { cli } = await appwriteContext(target, directory, execute);
  const supplied = installerCredentialFromEnvironment(env);
  const inventory = await cli(['project','list-keys','--project-id',target.projectId,'--limit','100']);
  requireThat(Array.isArray(inventory.keys) && Number.isInteger(inventory.total) && inventory.total === inventory.keys.length, 'Appwrite key inventory is truncated; no mutation performed');
  const key = inventory.keys.find((item) => item.$id === supplied.id);
  validateInstallerCredential(key, scopes);
  atomicJson(resolve(directory, 'temporary-key.json'), { projectId: target.projectId, id: key.$id, expire: key.expire, revoked: false, source: 'operator-created' });
  try {
    const sdk = await import('node-appwrite');
    const { InputFile } = await import('node-appwrite/file');
    const client = new sdk.Client().setEndpoint(target.endpoint).setProject(target.projectId).setKey(supplied.secret);
    return await operation({ db: new sdk.TablesDB(client), storage: new sdk.Storage(client), teams: new sdk.Teams(client), users: new sdk.Users(client), Query: sdk.Query, InputFile });
  } finally {
    try {
      await cli(['project','delete-key','--project-id',target.projectId,'--key-id',key.$id]);
      atomicJson(resolve(directory, 'temporary-key.json'), { projectId: target.projectId, id: key.$id, expire: key.expire, revoked: true, source: 'operator-created' });
    } finally {
      supplied.secret = undefined;
    }
  }
}

export async function paged(call, collection, Query) {
  const rows = []; let cursor; let total;
  for (let page = 0; page < 100000; page++) {
    const result = await call([Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
    requireThat(Array.isArray(result[collection]) && Number.isInteger(result.total), `Invalid ${collection} response`);
    if (total === undefined) total = result.total;
    requireThat(total === result.total, 'Inventory changed during pagination; freeze writes and retry');
    const values = result[collection]; rows.push(...values);
    if (!values.length || rows.length >= total) {
      requireThat(rows.length === total && new Set(rows.map((r) => r.$id ?? r.key)).size === rows.length, 'Pagination is incomplete or duplicated');
      return rows;
    }
    const next = values.at(-1).$id ?? values.at(-1).key;
    requireThat(next && next !== cursor, 'Pagination did not advance'); cursor = next;
  }
  throw new Error('Pagination safety limit exceeded');
}
export async function optional(call) { try { return await call(); } catch (error) { if (Number(error.code) === 404) return null; throw error; } }
export const rowData = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('$')));

export async function ensureWebPlatform(target, web, directory) {
  const { cli, cwd } = await appwriteContext(target, directory);
  const hostname = new URL(web.origin).hostname;
  const list = async () => {
    const result = await cli(['project','list-platforms','--project-id',target.projectId,'--limit','100']);
    requireThat(Array.isArray(result.platforms) && result.total === result.platforms.length, 'Appwrite platform inventory is truncated');
    return result.platforms;
  };
  let platforms = await list();
  let matches = platforms.filter((item) => item.hostname === hostname);
  let created = false;
  requireThat(matches.length <= 1, 'Duplicate Appwrite platform hostname requires manual review');
  if (matches.length === 0) {
    await requireCommand(['project','create-web-platform'], ['--project-id','--platform-id','--name','--hostname'], cwd);
    await cli(['project','create-web-platform','--project-id',target.projectId,'--platform-id',randomUUID(),'--name','ProInspect '+hostname,'--hostname',hostname]);
    created = true; platforms = await list(); matches = platforms.filter((item) => item.hostname === hostname);
  }
  requireThat(matches.length === 1 && matches[0].type === 'web', 'Required Appwrite web platform was not reconciled');
  return { hostname, platformId: matches[0].$id, created };
}
