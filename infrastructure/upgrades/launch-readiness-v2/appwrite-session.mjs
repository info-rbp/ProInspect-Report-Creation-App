import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, run, requireThat, manifest } from './runtime.mjs';

export async function appwriteContext(target, directory) {
  requireThat(target.endpoint === 'https://syd.cloud.appwrite.io/v1' && !manifest.prohibited.appwriteProjects.includes(target.projectId), 'Unapproved Appwrite target');
  requireThat(!process.env.APPWRITE_API_KEY, 'Unset APPWRITE_API_KEY; installer uses short-lived console-created credentials');
  const cwd = resolve(directory, 'appwrite-context');
  atomicJson(resolve(cwd, 'appwrite.config.json'), { projectId: target.projectId, projectName: target.projectName, endpoint: target.endpoint });
  const cli = async (args) => JSON.parse(await run('appwrite', ['--json', ...args], { cwd, live: true, sensitive: true, timeoutMs: 90000 }));
  const project = await cli(['project','get','--project-id',target.projectId]);
  requireThat(project.$id === target.projectId && project.name === target.projectName && project.status === 'active' && project.region === 'syd', 'Appwrite identity mismatch');
  return { cwd, cli, project };
}
export async function withAppwrite(target, directory, scopes, operation) {
  const { cwd, cli } = await appwriteContext(target, directory);
  const help = await run('appwrite', ['project','create-key','--help'], { cwd, timeoutMs: 30000 });
  for (const option of ['--project-id','--name','--scopes','--expire']) requireThat(help.includes(option), `Pinned CLI is missing ${option}; no mutation performed`);
  const name = `launch-${randomUUID()}`;
  const expire = new Date(Date.now() + 3600000).toISOString();
  let key;
  try {
    key = await cli(['project','create-key','--project-id',target.projectId,'--name',name,'--scopes',...scopes,'--expire',expire]);
    requireThat(key.$id && key.secret, 'CLI returned no usable temporary credential');
    atomicJson(resolve(directory, 'temporary-key.json'), { projectId: target.projectId, id: key.$id, expire, revoked: false });
    const sdk = await import('node-appwrite');
    const { InputFile } = await import('node-appwrite/file');
    const client = new sdk.Client().setEndpoint(target.endpoint).setProject(target.projectId).setKey(key.secret);
    return await operation({ db: new sdk.TablesDB(client), storage: new sdk.Storage(client), teams: new sdk.Teams(client), users: new sdk.Users(client), Query: sdk.Query, InputFile });
  } finally {
    if (key?.$id) {
      await cli(['project','delete-key','--project-id',target.projectId,'--key-id',key.$id]);
      atomicJson(resolve(directory, 'temporary-key.json'), { projectId: target.projectId, id: key.$id, expire, revoked: true });
      key.secret = undefined;
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
