import { readFileSync, writeFileSync } from 'node:fs';
const path = 'apps/api/src/backend/appwriteCollectionTransforms.ts';
const source = readFileSync(path, 'utf8');
const before = "function versionPayloadRead(value: StoredRecord): StoredRecord { const payload = parseObject(value.payload); const { payload: _payload, ...rest } = value; return { ...rest, ...payload, id: typeof payload.id === 'string' && payload.id ? payload.id : value.id, status: value.status, version: value.version, immutable: value.immutable, ...(value.publishedAt ? { publishedAt: value.publishedAt } : {}), ...(value.retiredAt ? { retiredAt: value.retiredAt } : {}) }; }";
const after = "function versionPayloadRead(value: StoredRecord): StoredRecord { const payload = parseObject(value.payload); const rest = { ...value }; delete rest.payload; return { ...rest, ...payload, id: typeof payload.id === 'string' && payload.id ? payload.id : value.id, status: value.status, version: value.version, immutable: value.immutable, ...(value.publishedAt ? { publishedAt: value.publishedAt } : {}), ...(value.retiredAt ? { retiredAt: value.retiredAt } : {}) }; }";
if (!source.includes(before)) throw new Error('Expected versionPayloadRead source was not found.');
writeFileSync(path, source.replace(before, after));
