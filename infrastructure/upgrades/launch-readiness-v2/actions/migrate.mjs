import { Buffer } from 'node:buffer';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, readJson, safePath, atomicJson, requireThat } from '../runtime.mjs';
import { privateDirectory } from '../configuration.mjs';
import { optional, rowData } from '../appwrite-session.mjs';

export const MAX_MIGRATION_FILE_BYTES = 128 * 1024 * 1024;

const ident = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(value);
export function validateBundle(bundle) {
  requireThat(bundle.schemaVersion === 1 && Array.isArray(bundle.rows) && Array.isArray(bundle.files), 'Invalid normalized migration bundle');
  requireThat(bundle.approvedBy?.length >= 3 && Number.isFinite(Date.parse(bundle.approvedAt)) && Date.parse(bundle.approvedAt) <= Date.now(), 'Migration mapping requires named, non-future dated approval');
  requireThat(Array.isArray(bundle.sourceDisposition) && bundle.sourceDisposition.length > 0,'Source disposition is required, including omitted sources');
  const dispositions=new Set();for(const item of bundle.sourceDisposition){requireThat(typeof item?.table==='string'&&item.table.trim()&&typeof item?.mode==='string'&&item.mode.trim()&&!dispositions.has(item.table),'Every source disposition requires one unique table and explicit mode');dispositions.add(item.table);}
  const seen = new Set();
  for (const row of bundle.rows) {
    requireThat(ident(row.tableId) && ident(row.id) && row.sourceSystem && row.sourceId !== undefined,'Invalid row identity');
    const key = `${row.tableId}/${row.id}`; requireThat(!seen.has(key),'Duplicate target row'); seen.add(key);
    requireThat(row.data && !Object.keys(row.data).some((k) => k.startsWith('$') || /password|session|token|secret/iu.test(k)), 'Credential or metadata import is prohibited');
    requireThat(Array.isArray(row.permissions) && !row.permissions.some((p) => /any|guests/u.test(p)), 'Explicit private row permissions required');
    requireThat(Array.isArray(row.parents),'Every row needs explicit parent references, even when empty');
    requireThat(hash(row.data) === row.sha256,'Normalized row checksum mismatch');
  }
  const files = new Set();
  for (const file of bundle.files) {
    requireThat(ident(file.bucketId) && ident(file.id) && typeof file.name === 'string' && file.name.trim().length > 0 && !/[\0]/u.test(file.name) && typeof file.path === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256),'Invalid file mapping');
    const id = `${file.bucketId}/${file.id}`; requireThat(!files.has(id),'Duplicate target file'); files.add(id);
    requireThat(Array.isArray(file.permissions) && !file.permissions.some((p) => /any|guests/u.test(p)),'Explicit private file permissions required');
  }
  return true;
}
export function orderedRows(rows) {
  const remaining = new Map(rows.map((r) => [`${r.tableId}/${r.id}`,r])); const result = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([,r]) => r.parents.every((p) => !remaining.has(`${p.tableId}/${p.id}`)));
    requireThat(ready.length,'Migration parent cycle');
    for (const [key,row] of ready) { result.push(row); remaining.delete(key); }
  }
  return result;
}
export function loadBundle(target) {
  const directory = privateDirectory(target.migration.bundleDirectory);
  const bytes = readFileSync(safePath(directory,'manifest.json'));
  requireThat(hash(bytes) === target.migration.bundleSha256,'Migration bundle differs from the approved SHA-256');
  const bundle = JSON.parse(bytes); validateBundle(bundle);
  requireThat(bundle.projectId === target.appwrite.projectId,'Migration bundle targets a different Appwrite project');
  return {bundle,directory};
}
export function reconcilePendingRow(item, actual) {
  if (!item || item.status !== 'PENDING') return item?.status ?? null;
  if (!actual) return 'RETRY';
  requireThat(hash(rowData(actual)) === item.sha256 && hash(actual.$permissions ?? []) === hash(item.permissions),'AMBIGUOUS_MIGRATION: interrupted row exists but differs from the journal');
  return 'CREATED';
}
export async function reconcilePendingFile(api,item,actual) {
  if (!item || item.status !== 'PENDING') return item?.status ?? null;
  if (!actual) return 'RETRY';
  const bytes=Buffer.from(await api.storage.getFileDownload(item.params));
  requireThat(hash(bytes)===item.sha256 && hash(actual.$permissions ?? [])===hash(item.permissions),'AMBIGUOUS_MIGRATION: interrupted file exists but differs from the journal');
  return 'CREATED';
}
export async function migrate(api,target,stateDirectory,mode) {
  requireThat(target.backup.freezeApproved === true,'Freeze writes before migration');
  const {bundle,directory} = loadBundle(target); const dbid = target.appwrite.databaseId;
  const journalPath = resolve(stateDirectory,`migration-${target.migration.bundleSha256}.json`);
  const journal = existsSync(journalPath) ? readJson(journalPath) : {projectId:target.appwrite.projectId,bundleSha256:target.migration.bundleSha256,rows:{},files:{},reconciliations:[]};
  requireThat(journal.projectId===target.appwrite.projectId && journal.bundleSha256===target.migration.bundleSha256,'Foreign migration journal');
  journal.reconciliations ??= [];
  const save = () => atomicJson(journalPath,journal);
  if (mode === 'data') for (const row of orderedRows(bundle.rows)) {
    const params = {databaseId:dbid,tableId:row.tableId,rowId:row.id}; const id = `${row.tableId}/${row.id}`;
    for (const parent of row.parents) requireThat(await optional(() => api.db.getRow({databaseId:dbid,tableId:parent.tableId,rowId:parent.id})),'Parent row is missing');
    let actual = await optional(() => api.db.getRow(params)); const pending=journal.rows[id];
    if (pending?.status==='PENDING') {
      const reconciled=reconcilePendingRow(pending,actual);
      if(reconciled==='CREATED'){pending.status='CREATED';pending.reconciledAt=new Date().toISOString();journal.reconciliations.push({kind:'row',id,status:'CREATED_AFTER_INTERRUPTION'});}
      else {delete journal.rows[id];journal.reconciliations.push({kind:'row',id,status:'RETRY_AFTER_MISSING'});}
      save();
    }
    actual = await optional(() => api.db.getRow(params)); const recorded=journal.rows[id];
    if (!actual) {
      requireThat(recorded?.status!=='PREEXISTING','AMBIGUOUS_MIGRATION: a pre-existing target row disappeared');
      journal.rows[id] = {status:'PENDING',params,sha256:row.sha256,permissions:row.permissions}; save();
      await api.db.createRow({...params,data:row.data,permissions:row.permissions});
      actual = await api.db.getRow(params);
      requireThat(hash(rowData(actual)) === row.sha256 && hash(actual.$permissions ?? []) === hash(row.permissions),'Created row differs from migration');
      journal.rows[id].status = 'CREATED'; journal.rows[id].completedAt=new Date().toISOString();
    } else if (!journal.rows[id]) journal.rows[id] = {status:'PREEXISTING',params,sha256:row.sha256,permissions:row.permissions};
    requireThat(hash(rowData(actual)) === row.sha256 && hash(actual.$permissions ?? []) === hash(row.permissions),'Existing row conflicts with migration; no overwrite allowed');
    save();
  }
  if (mode === 'files') for (const file of bundle.files) {
    const bytes = readFileSync(safePath(directory,file.path)); requireThat(bytes.length <= MAX_MIGRATION_FILE_BYTES && hash(bytes) === file.sha256,'Source file checksum or size mismatch');
    const params = {bucketId:file.bucketId,fileId:file.id}; const id = `${file.bucketId}/${file.id}`;
    let actual = await optional(() => api.storage.getFile(params)); const pending=journal.files[id];
    if(pending?.status==='PENDING'){
      const reconciled=await reconcilePendingFile(api,pending,actual);
      if(reconciled==='CREATED'){pending.status='CREATED';pending.reconciledAt=new Date().toISOString();journal.reconciliations.push({kind:'file',id,status:'CREATED_AFTER_INTERRUPTION'});}
      else {delete journal.files[id];journal.reconciliations.push({kind:'file',id,status:'RETRY_AFTER_MISSING'});}
      save();
    }
    actual=await optional(()=>api.storage.getFile(params)); const recorded=journal.files[id];
    if (!actual) {
      requireThat(recorded?.status!=='PREEXISTING','AMBIGUOUS_MIGRATION: a pre-existing target file disappeared');
      journal.files[id] = {status:'PENDING',params,sha256:file.sha256,permissions:file.permissions}; save();
      await api.storage.createFile({...params,file:api.InputFile.fromBuffer(bytes,file.name),permissions:file.permissions});
      actual = await api.storage.getFile(params);
      requireThat(hash(Buffer.from(await api.storage.getFileDownload(params))) === file.sha256 && hash(actual.$permissions ?? []) === hash(file.permissions),'Created file differs from migration');
      journal.files[id].status = 'CREATED'; journal.files[id].completedAt=new Date().toISOString();
    } else if (!journal.files[id]) journal.files[id] = {status:'PREEXISTING',params,sha256:file.sha256,permissions:file.permissions};
    requireThat(hash(Buffer.from(await api.storage.getFileDownload(params))) === file.sha256 && hash(actual.$permissions ?? []) === hash(file.permissions),'Target file differs; no overwrite allowed'); save();
  }
  return {bundleSha256:target.migration.bundleSha256,mode,rows:bundle.rows.length,files:bundle.files.length,journalPath,reconciliations:journal.reconciliations.length,sourceDeleted:false};
}
export async function rollbackMigration(api,target,stateDirectory) {
  const {bundle} = loadBundle(target);
  const path = resolve(stateDirectory,`migration-${target.migration.bundleSha256}.json`); const journal = readJson(path);
  requireThat(journal.projectId === target.appwrite.projectId && journal.bundleSha256 === target.migration.bundleSha256,'Foreign migration journal');
  for (const records of [journal.rows,journal.files]) requireThat(!Object.values(records).some((r) => r.status === 'PENDING'),'Ambiguous interrupted writes require reconciliation by re-running the matching migration stage before rollback');
  for (const row of orderedRows(bundle.rows).reverse()) {
    const item = journal.rows[`${row.tableId}/${row.id}`]; if (item?.status !== 'CREATED') continue;
    const live = await optional(() => api.db.getRow(item.params));
    requireThat(!live || (hash(rowData(live)) === item.sha256 && hash(live.$permissions ?? []) === hash(item.permissions)),'Rollback refuses an edited row');
    if (live) await api.db.deleteRow(item.params); item.status='REMOVED'; atomicJson(path,journal);
  }
  for (const item of Object.values(journal.files)) {
    if (item.status !== 'CREATED') continue;
    const live = await optional(() => api.storage.getFile(item.params));
    requireThat(!live || (hash(Buffer.from(await api.storage.getFileDownload(item.params))) === item.sha256 && hash(live.$permissions ?? []) === hash(item.permissions)),'Rollback refuses an edited file');
    if (live) await api.storage.deleteFile(item.params); item.status='REMOVED'; atomicJson(path,journal);
  }
  return {rolledBack:true,sourceDeleted:false};
}
