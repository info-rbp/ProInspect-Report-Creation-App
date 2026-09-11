import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, safePath, requireThat, atomicJson } from '../runtime.mjs';
import { privateDirectory } from '../configuration.mjs';
import { paged, rowData, optional } from '../appwrite-session.mjs';
import { ensureSchema } from './schema.mjs';

export function encryptionKey(env = process.env) {
  requireThat(/^[a-f0-9]{64}$/iu.test(env.LAUNCH_BACKUP_KEY ?? ''), 'Supply LAUNCH_BACKUP_KEY as a securely stored 32-byte hexadecimal key');
  return Buffer.from(env.LAUNCH_BACKUP_KEY,'hex');
}
export function seal(bytes, key) {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([Buffer.from('PIB1'),nonce,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
}
export function unseal(bytes, key) {
  requireThat(bytes.subarray(0,4).toString() === 'PIB1' && bytes.length >= 32, 'Invalid encrypted backup');
  const cipher = createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16)); cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(16,-16)),cipher.final()]);
}
const pick = (value, names) => Object.fromEntries(names.filter((key) => Object.hasOwn(value,key)).map((key) => [key,value[key]]));
const normalizedRows = (rows) => rows.map((r) => ({ id:r.$id, permissions:r.$permissions ?? [], data:rowData(r) })).sort((a,b) => a.id.localeCompare(b.id));
export async function backup(api, target, directory, runId) {
  requireThat(target.backup.freezeApproved === true, 'Freeze target writes and approve the maintenance window before backup');
  const destination = resolve(privateDirectory(target.backup.directory),runId);
  mkdirSync(destination,{recursive:true,mode:0o700}); const key = encryptionKey();
  const { db,storage,Query } = api; const databaseId = target.appwrite.databaseId;
  const existingDatabase = await optional(() => db.get({databaseId}));
  const tables = existingDatabase ? await paged((queries) => db.listTables({databaseId,queries}),'tables',Query) : [];
  const buckets = await paged((queries) => storage.listBuckets({queries}),'buckets',Query);
  const result = { version:1,runId,projectId:target.appwrite.projectId,databaseId,createdAt:new Date().toISOString(),schema:{tables:[],buckets:[]},rows:[],files:[] };
  const save = (name,bytes) => { writeFileSync(resolve(destination,name),seal(bytes,key),{flag:'wx',mode:0o600}); return hash(bytes); };
  for (const table of tables) {
    const common = {databaseId,tableId:table.$id};
    const columns = await paged((queries) => db.listColumns({...common,queries}),'columns',Query);
    const indexes = await paged((queries) => db.listIndexes({...common,queries}),'indexes',Query);
    result.schema.tables.push({...pick(table,['$id','name','$permissions','rowSecurity','enabled']),columns:columns.map((c) => pick(c,['key','type','required','array','size','format','elements','default','min','max'])),indexes:indexes.map((i) => pick(i,['key','type','columns','orders']))});
    const rows = normalizedRows(await paged((queries) => db.listRows({...common,queries}),'rows',Query));
    const bytes = Buffer.from(JSON.stringify(rows)); requireThat(bytes.length <= 128*1024*1024,'Table backup exceeds bounded memory budget');
    const path = `${hash(table.$id)}.rows.enc`; result.rows.push({tableId:table.$id,path,count:rows.length,sha256:save(path,bytes)});
  }
  for (const bucket of buckets) {
    result.schema.buckets.push(pick(bucket,['$id','name','$permissions','fileSecurity','enabled','maximumFileSize','allowedFileExtensions','compression','encryption','antivirus']));
    const files = await paged((queries) => storage.listFiles({bucketId:bucket.$id,queries}),'files',Query);
    for (const file of files) {
      requireThat(file.sizeOriginal <= 64*1024*1024,'File exceeds 64 MiB; use a reviewed streaming adapter');
      const bytes = Buffer.from(await storage.getFileDownload({bucketId:bucket.$id,fileId:file.$id}));
      requireThat(bytes.length === file.sizeOriginal,'File length mismatch');
      const path = `${hash(`${bucket.$id}/${file.$id}`)}.file.enc`;
      result.files.push({bucketId:bucket.$id,id:file.$id,name:file.name,permissions:file.$permissions ?? [],path,bytes:bytes.length,sha256:save(path,bytes)});
    }
  }
  for (const item of result.rows) {
    const rows = normalizedRows(await paged((queries) => db.listRows({databaseId,tableId:item.tableId,queries}),'rows',Query));
    requireThat(hash(JSON.stringify(rows)) === item.sha256,'Rows changed during backup; snapshot rejected');
  }
  for (const bucket of buckets) {
    const live = await paged((queries) => storage.listFiles({bucketId:bucket.$id,queries}),'files',Query);
    requireThat(live.length === result.files.filter((f) => f.bucketId === bucket.$id).length,'File inventory changed during backup');
    for (const file of live) {
      const saved = result.files.find((f) => f.bucketId === bucket.$id && f.id === file.$id);
      requireThat(saved && saved.name === file.name && hash(saved.permissions) === hash(file.$permissions ?? []) && saved.sha256 === hash(Buffer.from(await storage.getFileDownload({bucketId:bucket.$id,fileId:file.$id}))), 'File or permissions changed during backup');
    }
  }
  save('index.enc',Buffer.from(JSON.stringify(result)));
  const receipt = {runId,directory:destination,indexSha256:hash(readFileSync(resolve(destination,'index.enc'))),tables:result.rows.length,rows:result.rows.reduce((n,r) => n+r.count,0),files:result.files.length,restored:false,encryption:'AES-256-GCM',databaseSnapshot:true,fileSnapshot:true,consistencyVerified:true};
  atomicJson(resolve(directory,'backup.json'),receipt); return receipt;
}
export async function restoreProbe(api, receipt, sourceTarget, directory) {
  const key = encryptionKey(); const encrypted = readFileSync(safePath(receipt.directory,'index.enc'));
  requireThat(hash(encrypted) === receipt.indexSha256,'Backup index changed');
  const snapshot = JSON.parse(unseal(encrypted,key));
  requireThat(snapshot.projectId === sourceTarget.projectId && snapshot.databaseId === sourceTarget.databaseId,'Foreign backup');
  const suffix = hash(receipt.runId).slice(0,18); const databaseId = `lr_restore_${suffix}`;
  const buckets = new Map(snapshot.schema.buckets.map((b) => [b.$id,`lr_${hash(`${suffix}${b.$id}`).slice(0,26)}`]));
  const schema = {...snapshot.schema,buckets:snapshot.schema.buckets.map((b) => ({...b,$id:buckets.get(b.$id)}))};
  requireThat(!(await optional(() => api.db.get({databaseId}))), 'Restore target already exists; never overwrite');
  for (const bucketId of buckets.values()) requireThat(!(await optional(() => api.storage.getBucket({bucketId}))), 'Restore bucket already exists');
  const probeState={runId:receipt.runId,databaseId,buckets:[...buckets.values()],state:'STARTING'};atomicJson(resolve(directory,'restore-probe.json'),probeState);
  let primaryError=null;const cleanupErrors=[];let verified=false;
  try {
    await ensureSchema(api,schema,databaseId);
    for (const item of snapshot.rows) {
      const bytes = unseal(readFileSync(safePath(receipt.directory,item.path)),key); requireThat(hash(bytes) === item.sha256,'Backup rows failed checksum');
      for (const row of JSON.parse(bytes)) await api.db.createRow({databaseId,tableId:item.tableId,rowId:row.id,data:row.data,permissions:row.permissions});
      const actual = normalizedRows(await paged((queries) => api.db.listRows({databaseId,tableId:item.tableId,queries}),'rows',api.Query));
      requireThat(hash(JSON.stringify(actual)) === item.sha256,'Restored rows differ');
    }
    for (const item of snapshot.files) {
      const bytes = unseal(readFileSync(safePath(receipt.directory,item.path)),key); requireThat(hash(bytes) === item.sha256,'Backup file failed checksum');
      const bucketId = buckets.get(item.bucketId);
      await api.storage.createFile({bucketId,fileId:item.id,file:api.InputFile.fromBuffer(bytes,item.name),permissions:item.permissions});
      requireThat(hash(Buffer.from(await api.storage.getFileDownload({bucketId,fileId:item.id}))) === item.sha256,'Restored file differs');
    }
    for (const item of snapshot.files) {
      const file = await api.storage.getFile({bucketId:buckets.get(item.bucketId),fileId:item.id});
      requireThat(hash(file.$permissions ?? []) === hash(item.permissions), 'Restored file permissions differ');
    }
    verified=true;
  } catch(error) { primaryError=error; }
  finally {
    for(const bucketId of buckets.values()){
      try{if(await optional(()=>api.storage.getBucket({bucketId})))await api.storage.deleteBucket({bucketId});}catch(error){cleanupErrors.push(`bucket:${bucketId}:${error.message}`);}
    }
    try{if(await optional(()=>api.db.get({databaseId})))await api.db.delete({databaseId});}catch(error){cleanupErrors.push(`database:${databaseId}:${error.message}`);}
    atomicJson(resolve(directory,'restore-probe.json'),{...probeState,state:cleanupErrors.length?'CLEANUP_FAILED':verified?'VERIFIED_AND_REMOVED':'VERIFICATION_FAILED_CLEANUP_SUCCEEDED',cleanupErrors});
  }
  requireThat(cleanupErrors.length===0,`Restore probe cleanup failed: ${cleanupErrors.join('; ')}${primaryError ? `; verification error: ${primaryError.message}` : ''}`);
  if(primaryError)throw primaryError;
  const result = {...receipt,restored:true,completedAt:new Date().toISOString(),restoreDatabaseId:databaseId,restoreBuckets:[...buckets.values()],probeRemoved:true,checksumsVerified:true,permissionsVerified:true};
  atomicJson(resolve(directory,'backup.json'),result); return result;
}
