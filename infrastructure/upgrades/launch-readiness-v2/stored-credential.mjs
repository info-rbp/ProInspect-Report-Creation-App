import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonical, requireThat } from './runtime.mjs';
import { requireCommand } from './appwrite-contract.mjs';

export async function requireStoredKeyControl(cwd, execute) {
  for (const action of ['get-key', 'delete-key']) await requireCommand(['project', action], ['--project-id', '--key-id'], cwd, execute);
  await requireCommand(['project', 'list-keys'], ['--project-id', '--limit'], cwd, execute);
}
export function credentialInputs(environment, service) {
  requireThat(['development', 'staging', 'production'].includes(environment), 'Invalid credential environment');
  requireThat(/^[a-z][a-z0-9-]*$/u.test(service), 'Invalid credential service');
  const prefix = `LAUNCH_${environment}_${service}_APPWRITE`.toUpperCase().replaceAll('-', '_');
  return { id: `${prefix}_KEY_ID`, secret: `${prefix}_SECRET` };
}
export function equalSecrets(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function minimumRemainingMs(hours) { return Math.min(7200000, Math.max(900000, Math.floor(hours * 3600000 / 4))); }
export function validateStoredMetadata(key, id, scopes, maxHours, now = Date.now()) {
  requireThat(key && key.$id === id && typeof key.name === 'string' && key.name.trim().length > 0, 'Invalid stored key identity metadata');
  requireThat(Array.isArray(key.scopes) && key.scopes.every((s) => typeof s === 'string') && canonical([...key.scopes].sort()) === canonical([...scopes].sort()), 'Stored key scopes differ from policy');
  const expiry = Date.parse(key.expire);
  requireThat(Number.isFinite(expiry) && expiry > now + minimumRemainingMs(maxHours) && expiry <= now + maxHours * 3600000, 'Stored key expired, near expiry, or exceeds bounded lifetime');
  requireThat(key.type !== 'ephemeral' && key.revoked !== true, 'Stored revocable key required');
  return { id: key.$id, name: key.name, scopes: [...key.scopes].sort(), expire: key.expire };
}
// The Console-authenticated control plane must return the stored secret. A
// caller-supplied key ID or decoded JWT is not proof of credential identity.
export async function verifyStoredCredential(cli, target, { id, secret, scopes, maxHours }, now = Date.now()) {
  requireThat(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(id), 'Missing or invalid operator-created key ID');
  requireThat(typeof secret === 'string' && secret.length >= 16 && secret.trim() === secret && !/\s/u.test(secret) && !secret.startsWith('eyJ'), 'Missing or invalid stored credential; ephemeral JWTs are prohibited');
  let key;
  try {
    key = await cli(['project', 'get-key', '--project-id', target.projectId, '--key-id', id], { secret: true });
    const metadata = validateStoredMetadata(key, id, scopes, maxHours, now);
    requireThat(key.secret !== '[REDACTED]' && equalSecrets(key.secret, secret), 'Cannot verify supplied credential against stored key');
    return metadata;
  } finally { if (key) key.secret = undefined; }
}
