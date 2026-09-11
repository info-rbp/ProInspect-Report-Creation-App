import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const pkg = 'infrastructure/upgrades/launch-readiness-v2';
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const write = (path, content) => writeFileSync(resolve(root, path), content.endsWith('\n') ? content : content + '\n');
function replaceOne(path, before, after) {
  const value = read(path);
  if (!value.includes(before)) throw new Error('Missing patch anchor: ' + path + '\n' + before.slice(0, 180));
  if (value.indexOf(before) !== value.lastIndexOf(before)) throw new Error('Non-unique patch anchor: ' + path);
  write(path, value.replace(before, after));
}
function appendOnce(path, marker, value) {
  const current = read(path);
  if (!current.includes(marker)) write(path, current.trimEnd() + '\n\n' + value.trim() + '\n');
}

// 1. Process-group termination must never leave a delayed SIGKILL armed after child exit.
replaceOne(`${pkg}/process.mjs`, "      clean(); if (!stopped) clearTimeout(killTimer);", "      clean(); if (killTimer) clearTimeout(killTimer);");

// 2. Tighten non-production target identity and edge configuration validation.
replaceOne(`${pkg}/configuration.mjs`,
  "  requireThat(target.shopify?.domain === 'proinspect-2.myshopify.com' && target.shopify.apiVersion === '2026-07', 'Unexpected Shopify target');",
  "  requireThat(target.shopify?.domain === 'proinspect-2.myshopify.com' && target.shopify.apiVersion === '2026-07' && target.shopify.tokenEnv === 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'Unexpected Shopify target');");
replaceOne(`${pkg}/configuration.mjs`,
  "  requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(app.projectId), 'Invalid Appwrite project ID');",
  "  requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(app.projectId), 'Invalid Appwrite project ID');\n  if (environment === 'staging') requireThat(/staging/iu.test(app.projectName) && !/(?:prod|production)/iu.test(app.projectName), 'Staging Appwrite project name must explicitly identify Staging and cannot identify Production');");
replaceOne(`${pkg}/configuration.mjs`,
  "  requireThat(/^[a-f0-9]{32}$/iu.test(target.cloudflare.accountId), 'Invalid Cloudflare account');",
  "  requireThat(/^[a-f0-9]{32}$/iu.test(target.cloudflare.accountId), 'Invalid Cloudflare account');\n  requireThat(/^[A-Z][A-Z0-9_]*$/u.test(target.cloudflare.trustedEdgeSecretEnv ?? ''), 'Cloudflare origin secret must be referenced by an environment-variable name');\n  requireThat(typeof target.cloudflare.contentSecurityPolicy === 'string' && target.cloudflare.contentSecurityPolicy.includes(\"object-src 'none'\") && target.cloudflare.contentSecurityPolicy.includes(\"frame-ancestors 'none'\") && !/default-src\\s+\\*/iu.test(target.cloudflare.contentSecurityPolicy), 'Cloudflare CSP must explicitly block objects/framing and cannot use a wildcard default source');");

// 3. Align bounded backup/migration file support with 100 MiB Appwrite buckets.
replaceOne(`${pkg}/actions/backup.mjs`,
  "import { ensureSchema } from './schema.mjs';",
  "import { ensureSchema } from './schema.mjs';\n\nexport const MAX_BACKUP_FILE_BYTES = 128 * 1024 * 1024;");
replaceOne(`${pkg}/actions/backup.mjs`,
  "      requireThat(file.sizeOriginal <= 64*1024*1024,'File exceeds 64 MiB; use a reviewed streaming adapter');",
  "      requireThat(file.sizeOriginal <= MAX_BACKUP_FILE_BYTES,'File exceeds the 128 MiB bounded backup adapter; use a reviewed streaming adapter');");
replaceOne(`${pkg}/actions/migrate.mjs`,
  "import { optional, rowData } from '../appwrite-session.mjs';",
  "import { optional, rowData } from '../appwrite-session.mjs';\n\nexport const MAX_MIGRATION_FILE_BYTES = 128 * 1024 * 1024;");
replaceOne(`${pkg}/actions/migrate.mjs`,
  "  requireThat(bundle.approvedBy?.length >= 3 && Number.isFinite(Date.parse(bundle.approvedAt)), 'Migration mapping requires named, dated approval');",
  "  requireThat(bundle.approvedBy?.length >= 3 && Number.isFinite(Date.parse(bundle.approvedAt)) && Date.parse(bundle.approvedAt) <= Date.now(), 'Migration mapping requires named, non-future dated approval');");
replaceOne(`${pkg}/actions/migrate.mjs`,
  "  requireThat(Array.isArray(bundle.sourceDisposition) && bundle.sourceDisposition.length > 0,'Source disposition is required, including omitted sources');",
  "  requireThat(Array.isArray(bundle.sourceDisposition) && bundle.sourceDisposition.length > 0,'Source disposition is required, including omitted sources');\n  const dispositions=new Set();for(const item of bundle.sourceDisposition){requireThat(typeof item?.table==='string'&&item.table.trim()&&typeof item?.mode==='string'&&item.mode.trim()&&!dispositions.has(item.table),'Every source disposition requires one unique table and explicit mode');dispositions.add(item.table);}");
replaceOne(`${pkg}/actions/migrate.mjs`,
  "    requireThat(ident(file.bucketId) && ident(file.id) && typeof file.path === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256),'Invalid file mapping');",
  "    requireThat(ident(file.bucketId) && ident(file.id) && typeof file.name === 'string' && file.name.trim().length > 0 && !/[\\0]/u.test(file.name) && typeof file.path === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256),'Invalid file mapping');");
replaceOne(`${pkg}/actions/migrate.mjs`,
  "    const bytes = readFileSync(safePath(directory,file.path)); requireThat(bytes.length <= 64*1024*1024 && hash(bytes) === file.sha256,'Source file checksum or size mismatch');",
  "    const bytes = readFileSync(safePath(directory,file.path)); requireThat(bytes.length <= MAX_MIGRATION_FILE_BYTES && hash(bytes) === file.sha256,'Source file checksum or size mismatch');");

// 4. Action-state evidence must be bound to the current source/configuration.
replaceOne('infrastructure/launch-scenarios/common.mjs',
  "import { canonical, hash, readJson, requireThat, safePath } from '../upgrades/launch-readiness-v2/runtime.mjs';",
  "import { canonical, hash, readJson, requireThat, safePath, sameSourceCandidate } from '../upgrades/launch-readiness-v2/runtime.mjs';");
replaceOne('infrastructure/launch-scenarios/common.mjs',
  "export function actionState(id) {\n  const path = resolve(stateEnvironmentDirectory(), 'actions', id + '.json');\n  return existsSync(path) ? readJson(path) : null;\n}",
  "export function actionState(id) {\n  const path = resolve(stateEnvironmentDirectory(), 'actions', id + '.json');\n  return existsSync(path) ? readJson(path) : null;\n}\nexport function currentAction(id, input, { exactConfig = true } = {}) {\n  const value = actionState(id);\n  requireThat(value?.status === 'SUCCEEDED' && sameSourceCandidate(value.candidate, input.candidate), 'Action state is missing or belongs to another source candidate: ' + id);\n  if (exactConfig) requireThat(value.candidate?.configHash === input.candidate.configHash, 'Action state belongs to another environment configuration: ' + id);\n  return value;\n}");

// 5. Persist the post-credential backup as the current backup action, not only last-backup.json.
replaceOne(`${pkg}/installation.mjs`,
  "        const backupFolder=resolve(session,'post-credential-backup');mkdirSync(backupFolder,{recursive:true,mode:0o700});\n        await action('backup',current,context,backupFolder,directory,randomUUID());",
  "        const backupFolder=resolve(session,'post-credential-backup');mkdirSync(backupFolder,{recursive:true,mode:0o700});\n        const backupResult=await action('backup',current,context,backupFolder,directory,randomUUID());\n        atomicJson(resolve(directory,args.env,'actions','backup.json'),{status:'SUCCEEDED',id:'backup',candidate:context,folder:backupFolder,result:backupResult,completedAt:new Date().toISOString()});");

// 6. Replace stale runtime env/secrets rather than carrying legacy Firebase configuration into Appwrite releases.
replaceOne(`${pkg}/actions/google.mjs`,
  "  const vars={...configured.env,APP_VERSION:commit,APPWRITE_ENDPOINT:target.appwrite.endpoint,APPWRITE_PROJECT_ID:target.appwrite.projectId,APPWRITE_DATABASE_ID:target.appwrite.databaseId};",
  "  const vars={...configured.env,APP_ENV:target.google.environment,NODE_ENV:target.google.environment==='production'?'production':'development',GOOGLE_CLOUD_PROJECT:target.google.projectId,APP_VERSION:commit,APPWRITE_ENDPOINT:target.appwrite.endpoint,APPWRITE_PROJECT_ID:target.appwrite.projectId,APPWRITE_DATABASE_ID:target.appwrite.databaseId};");
replaceOne(`${pkg}/actions/google.mjs`,
  "  requireThat(configured.env.AUTH_PROVIDER === 'appwrite' && configured.env.APPWRITE_BACKEND_MODE === 'appwrite','Explicit Appwrite runtime configuration required');\n  return ['--update-env-vars',`^|^${Object.entries(vars).map(([k,v])=>`${k}=${v}`).join('|')}`,...(secrets.length ? ['--update-secrets',secrets.join(',')] : [])];",
  "  requireThat(configured.env.AUTH_PROVIDER === 'appwrite' && configured.env.APPWRITE_BACKEND_MODE === 'appwrite','Explicit Appwrite runtime configuration required');\n  requireThat(secrets.some((value)=>value.startsWith('APPWRITE_API_KEY=')),'Every deployed service requires an immutable Appwrite runtime credential');\n  return ['--set-env-vars',`^|^${Object.entries(vars).map(([k,v])=>`${k}=${v}`).join('|')}`,...(secrets.length ? ['--set-secrets',secrets.join(',')] : ['--clear-secrets'])];");

// 7. Custom-domain workers should not accidentally retain workers.dev exposure.
replaceOne(`${pkg}/actions/cloudflare.mjs`,
  "    const config={name:target.cloudflare.workerName,account_id:target.cloudflare.accountId,main:resolve(packageRoot,'edge-entry.mjs'),compatibility_date:'2026-08-23',workers_dev:true,assets:{directory:resolve(root,'apps/web/dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/v1/*','/health','/__launch/*']},vars:{GOOGLE_API_ORIGIN:target.cloudflare.apiOrigin,RELEASE_SHA:context.commit,CONTENT_SECURITY_POLICY:target.cloudflare.contentSecurityPolicy},version_metadata:{binding:'CF_VERSION_METADATA'},observability:{enabled:true}};\n    const origin=new URL(target.web.origin); if(!origin.hostname.endsWith('.workers.dev'))config.routes=[{pattern:origin.hostname,custom_domain:true}];",
  "    const origin=new URL(target.web.origin);\n    const config={name:target.cloudflare.workerName,account_id:target.cloudflare.accountId,main:resolve(packageRoot,'edge-entry.mjs'),compatibility_date:'2026-08-23',workers_dev:origin.hostname.endsWith('.workers.dev'),assets:{directory:resolve(root,'apps/web/dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/v1/*','/health','/__launch/*']},vars:{GOOGLE_API_ORIGIN:target.cloudflare.apiOrigin,RELEASE_SHA:context.commit,CONTENT_SECURITY_POLICY:target.cloudflare.contentSecurityPolicy},version_metadata:{binding:'CF_VERSION_METADATA'},observability:{enabled:true}};\n    if(!origin.hostname.endsWith('.workers.dev'))config.routes=[{pattern:origin.hostname,custom_domain:true}];");

// 8. Runtime credential failure cleanup: disable an orphan Secret Manager version as well as deleting the Appwrite key.
replaceOne(`${pkg}/actions/credentials.mjs`,
  "    const expire=new Date(Date.now()+policy.expiryHours*3600000).toISOString();let key;let stored=false;",
  "    const expire=new Date(Date.now()+policy.expiryHours*3600000).toISOString();let key;let stored=false;let secretVersion=null;");
replaceOne(`${pkg}/actions/credentials.mjs`,
  "      const number=version.name?.split('/').at(-1);requireThat(/^[0-9]+$/u.test(number),'No immutable secret version returned');",
  "      const number=version.name?.split('/').at(-1);requireThat(/^[0-9]+$/u.test(number),'No immutable secret version returned');secretVersion=number;");
replaceOne(`${pkg}/actions/credentials.mjs`,
  "      if(key?.$id && !stored)await cli(['project','delete-key','--project-id',target.appwrite.projectId,'--key-id',key.$id]);\n      if(key)key.secret=undefined;",
  "      if(key?.$id && !stored){await cli(['project','delete-key','--project-id',target.appwrite.projectId,'--key-id',key.$id]);if(secretVersion)await run('gcloud',['secrets','versions','disable',secretVersion,'--secret',policy.secretId,'--project',target.google.projectId,'--quiet'],{live:true,sensitive:true}).catch(()=>{});}\n      if(key)key.secret=undefined;");

// 9. Reconcile the target Appwrite web platform through the authenticated console CLI.
appendOnce(`${pkg}/appwrite-session.mjs`, 'export async function ensureWebPlatform', `export async function ensureWebPlatform(target, web, directory) {
  const { cli, cwd } = await appwriteContext(target, directory);
  const hostname = new URL(web.origin).hostname;
  const list = async () => {
    const result = await cli(['project','list-platforms','--project-id',target.projectId,'--limit','100']);
    requireThat(Array.isArray(result.platforms) && result.total === result.platforms.length, 'Appwrite platform inventory is truncated');
    return result.platforms;
  };
  let platforms = await list();
  let matches = platforms.filter((item) => item.hostname === hostname);
  requireThat(matches.length <= 1, 'Duplicate Appwrite platform hostname requires manual review');
  if (matches.length === 0) {
    const help = await run('appwrite',['project','create-platform','--help'],{cwd,timeoutMs:30000});
    for (const flag of ['--project-id','--type','--name','--hostname']) requireThat(help.includes(flag), 'Pinned Appwrite CLI cannot create the required web platform: ' + flag);
    await cli(['project','create-platform','--project-id',target.projectId,'--type','web','--name','ProInspect '+hostname,'--hostname',hostname]);
    platforms = await list(); matches = platforms.filter((item) => item.hostname === hostname);
  }
  requireThat(matches.length === 1 && matches[0].type === 'web', 'Required Appwrite web platform was not reconciled');
  return { hostname, platformId: matches[0].$id, created: !platforms.some((item) => item.$id === matches[0].$id && item.hostname === hostname) ? true : undefined };
}`);
// The created flag above is diagnostic only; simplify it deterministically.
replaceOne(`${pkg}/appwrite-session.mjs`,
  "  let platforms = await list();\n  let matches = platforms.filter((item) => item.hostname === hostname);",
  "  let platforms = await list();\n  let matches = platforms.filter((item) => item.hostname === hostname);\n  let created = false;");
replaceOne(`${pkg}/appwrite-session.mjs`,
  "    platforms = await list(); matches = platforms.filter((item) => item.hostname === hostname);",
  "    created = true; platforms = await list(); matches = platforms.filter((item) => item.hostname === hostname);");
replaceOne(`${pkg}/appwrite-session.mjs`,
  "  return { hostname, platformId: matches[0].$id, created: !platforms.some((item) => item.$id === matches[0].$id && item.hostname === hostname) ? true : undefined };",
  "  return { hostname, platformId: matches[0].$id, created };");

replaceOne(`${pkg}/actions/index.mjs`,
  "import { withAppwrite } from '../appwrite-session.mjs';",
  "import { withAppwrite,ensureWebPlatform } from '../appwrite-session.mjs';");
replaceOne(`${pkg}/actions/index.mjs`,
  "    if(id==='schema'){\n      const schema=await sourceSchema();return ensureSchema(api,schema,app.databaseId);\n    }",
  "    if(id==='schema'){\n      const schema=await sourceSchema();const installed=await ensureSchema(api,schema,app.databaseId);const platform=await ensureWebPlatform(app,target.web,directory);return {...installed,platform};\n    }");

// 10. Existing Appwrite resources must match the full source contract, not just their ACLs.
replaceOne(`${pkg}/actions/schema.mjs`,
  "  const database = await optional(() => db.get({ databaseId }));\n  if (!database) await db.create({ databaseId, name: schema.databases?.find((d) => d.$id === databaseId)?.name ?? databaseId, enabled: true });",
  "  const wantedDatabase=schema.databases?.find((d)=>d.$id===databaseId);requireThat(wantedDatabase,'Source database definition is missing');\n  const database = await optional(() => db.get({ databaseId }));\n  if (!database) await db.create({ databaseId, name: wantedDatabase.name ?? databaseId, enabled: wantedDatabase.enabled ?? true });\n  else requireThat(database.name===wantedDatabase.name && database.enabled===wantedDatabase.enabled,'Existing database definition differs from source');");
replaceOne(`${pkg}/actions/schema.mjs`,
  "    else requireThat(existing.rowSecurity === true && existing.$permissions?.length === 0, `Unexpected live table permissions: ${table.$id}`);",
  "    else requireThat(existing.name===table.name && existing.rowSecurity===table.rowSecurity && existing.enabled===table.enabled && canonical(existing.$permissions ?? [])===canonical(table.$permissions ?? []), `Existing table definition differs from source: ${table.$id}`);");
replaceOne(`${pkg}/actions/schema.mjs`,
  "    else for (const key of ['fileSecurity','$permissions','encryption','antivirus','maximumFileSize','allowedFileExtensions']) requireThat(canonical(existing[key]) === canonical(bucket[key]), `Bucket drift requires review: ${bucket.$id}.${key}`);",
  "    else for (const key of ['name','fileSecurity','$permissions','enabled','encryption','antivirus','maximumFileSize','allowedFileExtensions','compression']) requireThat(canonical(existing[key]) === canonical(bucket[key]), `Bucket drift requires review: ${bucket.$id}.${key}`);");

// 11. Make Appwrite schema/key/domain audit reusable by Production final verification.
write(`${pkg}/adapters/appwrite-cli.mjs`, `import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acceptance } from '../adapter-sdk.mjs';
import { canonical, requireThat } from '../runtime.mjs';
import { appwriteContext } from '../appwrite-session.mjs';
import { sourceSchema, columnChanges } from '../actions/schema.mjs';
export function approvedKeys(actual,approved,now=Date.now()) {
  return actual.length===approved.length && actual.every((key)=>{
    const wanted=approved.find((v)=>v.id===key.$id);
    return wanted && key.name===wanted.name && canonical([...key.scopes].sort())===canonical([...wanted.scopes].sort()) && Date.parse(key.expire)===Date.parse(wanted.expire) && Date.parse(key.expire)>now;
  });
}
export async function appwriteSchemaAudit(target,directory){
  const app=target.appwrite;const {cli,project}=await appwriteContext(app,directory);const schema=await sourceSchema();const errors=[];const unavailable=[];
  const list=async(args,key)=>{const r=await cli(args);requireThat(Array.isArray(r[key]) && r.total===r[key].length,'Truncated schema response: '+key);return r[key];};
  const tables=await list(['tablesdb','list-tables','--database-id',app.databaseId,'--limit','500'],'tables');
  if(canonical(tables.map((t)=>t.$id).sort())!==canonical(schema.tables.map((t)=>t.$id).sort()))errors.push('table IDs');
  for(const wanted of schema.tables){const live=tables.find((t)=>t.$id===wanted.$id);if(!live){errors.push(wanted.$id);continue;}for(const key of ['name','rowSecurity','enabled','$permissions'])if(canonical(live[key])!==canonical(wanted[key]))errors.push(wanted.$id+'.'+key);const base=['--database-id',app.databaseId,'--table-id',wanted.$id,'--limit','500'];const columns=await list(['tablesdb','list-columns',...base],'columns');const indexes=await list(['tablesdb','list-indexes',...base],'indexes');if(columns.length!==wanted.columns.length||indexes.length!==wanted.indexes.length)errors.push(wanted.$id+'.counts');for(const column of wanted.columns){const c=columns.find((v)=>v.key===column.key);if(!c||columnChanges(column,c).length)errors.push(wanted.$id+'.'+column.key);if(c?.status!=='available')unavailable.push(wanted.$id+'.'+column.key);}for(const index of wanted.indexes){const i=indexes.find((v)=>v.key===index.key);if(!i||['type','columns','orders'].some((k)=>canonical(i[k]??[])!==canonical(index[k]??[])))errors.push(wanted.$id+'.'+index.key);if(i?.status!=='available')unavailable.push(wanted.$id+'.'+index.key);}}
  const teams=await list(['teams','list','--limit','100'],'teams');if(canonical(teams.map((t)=>[t.$id,t.name]).sort())!==canonical(schema.teams.map((t)=>[t.$id,t.name]).sort()))errors.push('team definitions');
  const databases=await list(['tablesdb','list','--limit','100'],'databases');if(canonical(databases.map((d)=>[d.$id,d.name,d.enabled]).sort())!==canonical(schema.databases.map((d)=>[d.$id,d.name,d.enabled]).sort()))errors.push('database definitions');
  const buckets=await list(['storage','list-buckets','--limit','100'],'buckets');const bucketErrors=[];for(const b of buckets)if(!schema.buckets.some((s)=>s.$id===b.$id))bucketErrors.push(b.$id);for(const b of schema.buckets){const live=buckets.find((v)=>v.$id===b.$id);if(!live||['name','$permissions','fileSecurity','enabled','encryption','antivirus','maximumFileSize','allowedFileExtensions','compression'].some((k)=>canonical(live[k])!==canonical(b[k])))bucketErrors.push(b.$id);}
  const keys=await list(['project','list-keys','--project-id',app.projectId,'--limit','100'],'keys');const platforms=await list(['project','list-platforms','--project-id',app.projectId,'--limit','100'],'platforms');const domainMatches=platforms.filter((p)=>p.type==='web'&&p.hostname===new URL(target.web.origin).hostname);
  const leastPrivilege=tables.every((t)=>t.rowSecurity&&t.$permissions.length===0)&&buckets.every((b)=>b.fileSecurity&&b.$permissions.length===0);
  return {projectId:project.$id,expectedProjectId:app.projectId,tables:tables.length,errors,unavailable,bucketErrors,leastPrivilege,approvedKeys:approvedKeys(keys,app.approvedRuntimeKeys??[]),registeredDomains:domainMatches.length===1,registeredDomainCount:domainMatches.length};
}
export async function verifyAppwrite(){const session=acceptance();const audit=await appwriteSchemaAudit(session.input.target,dirname(process.env.PROINSPECT_LAUNCH_OUTPUT));session.check('exact_project_identity',audit.projectId,audit.expectedProjectId);session.check('schema_bidirectional',audit.errors,[]);session.check('indexes_available',audit.unavailable,[]);session.check('bucket_permissions',audit.bucketErrors,[]);session.check('least_privilege',audit.leastPrivilege,true);session.check('no_unapproved_keys',audit.approvedKeys,true);session.check('registered_domains',audit.registeredDomains,true);session.artifact('schema.json',JSON.stringify(audit));session.finish();}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{await verifyAppwrite();}catch(error){console.error(error.message);process.exitCode=1;}}
`);

// 12. Real idempotency proof for structured and binary migration reruns.
replaceOne('infrastructure/launch-scenarios/files.mjs',
  "import { Buffer } from 'node:buffer';\nimport { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';",
  "import { Buffer } from 'node:buffer';\nimport { readFileSync } from 'node:fs';\nimport { canonical, hash } from '../upgrades/launch-readiness-v2/runtime.mjs';");
replaceOne('infrastructure/launch-scenarios/files.mjs',
  "  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['files.read','files.write'],(api)=>migrate(api,target,stateEnvironmentDirectory(),'files'));\n  probe.check('idempotent_copy_resume',true,true);",
  "  const journalPath=stateEnvironmentDirectory()+'/migration-'+target.migration.bundleSha256+'.json';const before=JSON.parse(readFileSync(journalPath,'utf8'));\n  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['files.read','files.write'],(api)=>migrate(api,target,stateEnvironmentDirectory(),'files'));\n  const after=JSON.parse(readFileSync(journalPath,'utf8'));let afterFound=0;let afterExact=true;\n  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['files.read'],async(api)=>{for(const item of bundle.files){const meta=await optional(()=>api.storage.getFile({bucketId:item.bucketId,fileId:item.id}));if(meta)afterFound+=1;if(!meta||hash(meta.$permissions??[])!==hash(item.permissions)){afterExact=false;continue;}const bytes=Buffer.from(await api.storage.getFileDownload({bucketId:item.bucketId,fileId:item.id}));if(hash(bytes)!==item.sha256)afterExact=false;}});\n  probe.check('idempotent_copy_resume',canonical(before)===canonical(after)&&afterFound===bundle.files.length&&afterExact,true);");

replaceOne('infrastructure/launch-scenarios/migration.mjs',
  "  const after=readFileSync(journalPath,'utf8');\n  probe.check('zero_duplicate_rerun',duplicateRejected && JSON.parse(after).bundleSha256===JSON.parse(before).bundleSha256,true);",
  "  const after=readFileSync(journalPath,'utf8');let afterCount=0;let afterChecksums=true;\n  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['rows.read'],async(api)=>{for(const row of bundle.rows){const live=await optional(()=>api.db.getRow({databaseId:target.appwrite.databaseId,tableId:row.tableId,rowId:row.id}));if(live)afterCount+=1;if(!live||hash(rowData(live))!==row.sha256||hash(live.$permissions??[])!==hash(row.permissions))afterChecksums=false;}});\n  probe.check('zero_duplicate_rerun',duplicateRejected && hash(JSON.parse(after))===hash(JSON.parse(before)) && afterCount===bundle.rows.length && afterChecksums,true);");

// 13. Bind backup/rehearsal prerequisites to the current candidate instead of accepting stale action files.
replaceOne('infrastructure/launch-scenarios/recovery.mjs',
  "import { actionState, applyExternalChecks } from './common.mjs';",
  "import { currentAction, applyExternalChecks } from './common.mjs';");
replaceOne('infrastructure/launch-scenarios/recovery.mjs',
  "  const state=actionState('backup');\n  requireThat(state?.status==='SUCCEEDED' && state.candidate.commit===probe.input.candidate.commit,'Current-candidate backup action has not succeeded');",
  "  const state=currentAction('backup',probe.input);\n  requireThat(state.result?.restored===true,'Current-candidate backup action has not succeeded');");
replaceOne('infrastructure/launch-scenarios/operations.mjs',
  "import { actionState, applyExternalChecks } from './common.mjs';",
  "import { currentAction, applyExternalChecks } from './common.mjs';");
replaceOne('infrastructure/launch-scenarios/operations.mjs',
  "  const backup=actionState('backup');const age=Date.now()-Date.parse(backup?.result?.completedAt);",
  "  const backup=currentAction('backup',probe.input);const age=Date.now()-Date.parse(backup?.result?.completedAt);");
replaceOne('infrastructure/launch-scenarios/rehearsal.mjs',
  "import { actionState, applyExternalChecks, receipt } from './common.mjs';",
  "import { currentAction, applyExternalChecks, receipt } from './common.mjs';");
replaceOne('infrastructure/launch-scenarios/rehearsal.mjs',
  "  requireThat(actionState('data')?.status==='SUCCEEDED'&&receipt('identity')?.status==='PASS'&&receipt('offline')?.status==='PASS','Staging migration/persona/device prerequisites are incomplete');\n  requireThat(['terraform','google','cloudflare','shopify'].every((id)=>actionState(id)?.status==='SUCCEEDED'),'Staging provider installation is incomplete');\n  requireThat(actionState('backup')?.result?.restored===true,'Staging restore rehearsal prerequisite is incomplete');",
  "  const data=currentAction('data',probe.input,{exactConfig:false});const terraform=currentAction('terraform',probe.input,{exactConfig:false});const google=currentAction('google',probe.input);const cloudflare=currentAction('cloudflare',probe.input);const shopify=currentAction('shopify',probe.input);const backup=currentAction('backup',probe.input);\n  requireThat(data&&receipt('identity')?.status==='PASS'&&receipt('offline')?.status==='PASS','Staging migration/persona/device prerequisites are incomplete');\n  requireThat(terraform&&google&&cloudflare&&shopify,'Staging provider installation is incomplete');\n  requireThat(backup.result?.restored===true,'Staging restore rehearsal prerequisite is incomplete');");
replaceOne('infrastructure/launch-scenarios/rehearsal.mjs',
  "  probe.artifact('rehearsal-live.json',Buffer.from(JSON.stringify({migration:actionState('data')?.completedAt,restore:actionState('backup')?.completedAt,runbook,observedAt:evidence?.observedAt??null})));",
  "  probe.artifact('rehearsal-live.json',Buffer.from(JSON.stringify({migration:data.completedAt,restore:backup.completedAt,runbook,observedAt:evidence?.observedAt??null})));" );

// 14. Count direct provider assertions as direct evidence instead of needlessly requiring an external PASS file.
replaceOne('infrastructure/launch-scenarios/commerce-calendar.mjs',
  "import { applyExternalChecks, actionState } from './common.mjs';",
  "import { applyExternalChecks, currentAction } from './common.mjs';");
replaceOne('infrastructure/launch-scenarios/commerce-calendar.mjs',
  "  const replay=actionState('shopify'); requireThat(replay?.status==='SUCCEEDED' && replay.result?.shopifyStoreMutated===false,'Synthetic Shopify installation replay is missing or unsafe');\n  applyExternalChecks(probe,probe.input,probe.input.gate.checks,['automated-test']);",
  "  const replay=currentAction('shopify',probe.input); requireThat(replay.result?.shopifyStoreMutated===false,'Synthetic Shopify installation replay is missing or unsafe');\n  probe.check('authenticated_exact_shop',shop.domain===target.shopify.domain&&Boolean(shop.shopId),true);\n  probe.check('no_live_webhook_switch',replay.result.shopifyStoreMutated===false,true);\n  applyExternalChecks(probe,probe.input,probe.input.gate.checks.filter((id)=>!['authenticated_exact_shop','no_live_webhook_switch'].includes(id)),['automated-test']);");

// 15. Identity acceptance exercises a real recovery-code challenge and direct assignment denials.
replaceOne('infrastructure/launch-scenarios/identity.mjs',
  "  let sessionRevoked=false;let mfaPassed=false;",
  "  let sessionRevoked=false;let mfaPassed=false;let recoveryPassed=false;");
replaceOne('infrastructure/launch-scenarios/identity.mjs',
  "      const verified=await challengeAccount.getSession({sessionId:'current'});mfaPassed=verified.factors?.includes('totp')===true;",
  "      const verified=await challengeAccount.getSession({sessionId:'current'});mfaPassed=verified.factors?.includes('totp')===true;\n      await api.users.deleteSessions({userId});const recoverySession=await authenticate(app,userId,password);const recoveryAccount=new Account(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(recoverySession));const recoveryChallenge=await recoveryAccount.createMFAChallenge({factor:'recoverycode'});await recoveryAccount.updateMFAChallenge({challengeId:recoveryChallenge.$id,otp:recovery.recoveryCodes[0]});recoveryPassed=Boolean((await recoveryAccount.get()).$id);");
replaceOne('infrastructure/launch-scenarios/identity.mjs',
  "  probe.check('mfa_enrol_challenge_recover',mfaPassed,true);\n  probe.check('session_revocation',sessionRevoked,true);\n  applyExternalChecks(probe,probe.input,['email_verification_recovery','cross_agency_site_client_unit_denial','contractor_inspector_assignment_denial','relief_expiry','stale_occupancy_denial','multi_portal_identity'],['automated-test']);\n  probe.artifact('identity-live.json',Buffer.from(JSON.stringify({portals:portals.map(([id,userId])=>({id,userId})),mfaPassed,sessionRevoked,siteDenial,assignmentDiagnostic})));",
  "  probe.check('mfa_enrol_challenge_recover',mfaPassed&&recoveryPassed,true);\n  probe.check('session_revocation',sessionRevoked,true);\n  probe.check('contractor_inspector_assignment_denial',assignmentDiagnostic,true);\n  applyExternalChecks(probe,probe.input,['email_verification_recovery','cross_agency_site_client_unit_denial','relief_expiry','stale_occupancy_denial','multi_portal_identity'],['automated-test']);\n  probe.artifact('identity-live.json',Buffer.from(JSON.stringify({portals:portals.map(([id,userId])=>({id,userId})),mfaPassed,recoveryPassed,sessionRevoked,siteDenial,assignmentDiagnostic})));" );

// 16. Shopify webhook inventory is cursor-paginated and duplicate-safe.
write(`${pkg}/actions/shopify-production.mjs`, `import { requireThat } from '../runtime.mjs';
import { request, shopifyAudit } from '../providers.mjs';

export const requiredShopifyTopics=['ORDERS_CREATE','ORDERS_PAID','ORDERS_UPDATED','ORDERS_CANCELLED','REFUNDS_CREATE'];
async function graphQl(target,query,variables={},env=process.env) {
  requireThat(target.tokenEnv==='SHOPIFY_ADMIN_ACCESS_TOKEN' && env[target.tokenEnv],'Approved Shopify Admin token environment is required');
  const {response,text}=await request('https://'+target.domain+'/admin/api/'+target.apiVersion+'/graphql.json',{method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':env[target.tokenEnv]},body:JSON.stringify({query,variables})});
  const payload=JSON.parse(text);requireThat(!payload.errors?.length && payload.data,'Shopify GraphQL operation failed');requireThat(response.headers.get('x-shopify-api-version')===target.apiVersion,'Shopify API version fallback');return payload.data;
}
export function subscriptionState(nodes,target){
  requireThat(Array.isArray(nodes),'Shopify webhook inventory missing');const missing=[];const duplicates=[];
  for(const topic of requiredShopifyTopics){const exact=nodes.filter((item)=>item.topic===topic&&item.uri===target.webhookUri);if(exact.length===0)missing.push(topic);if(exact.length>1)duplicates.push({topic,count:exact.length,ids:exact.map((item)=>item.id)});}
  const legacy=nodes.filter((item)=>requiredShopifyTopics.includes(item.topic)&&item.uri!==target.webhookUri).map(({id,topic,uri})=>({id,topic,uri}));
  return {missing,duplicates,legacy,configured:requiredShopifyTopics.length-missing.length};
}
export async function auditShopifySubscriptions(target,env=process.env) {
  await shopifyAudit(target,{env});requireThat(typeof target.webhookUri==='string'&&target.webhookUri.startsWith('https://'),'Approved Shopify webhook URI is required');
  const nodes=[];let after=null;const cursors=new Set();
  for(let page=0;page<100;page+=1){const data=await graphQl(target,\`query ProInspectReleaseWebhooks($after: String) { webhookSubscriptions(first: 250, after: $after) { nodes { id topic uri } pageInfo { hasNextPage endCursor } } }\`,{after},env);const connection=data.webhookSubscriptions;requireThat(Array.isArray(connection?.nodes)&&connection?.pageInfo,'Shopify webhook connection is invalid');nodes.push(...connection.nodes);if(!connection.pageInfo.hasNextPage)break;const next=connection.pageInfo.endCursor;requireThat(typeof next==='string'&&next&&!cursors.has(next),'Shopify webhook pagination did not advance');cursors.add(next);after=next;if(page===99)throw new Error('Shopify webhook inventory exceeded pagination safety limit');}
  requireThat(new Set(nodes.map((item)=>item.id)).size===nodes.length,'Shopify webhook inventory contains duplicate IDs');return {domain:target.domain,webhookUri:target.webhookUri,...subscriptionState(nodes,target),total:nodes.length};
}
export async function reconcileShopifySubscriptions(target,env=process.env) {
  const before=await auditShopifySubscriptions(target,env);requireThat(before.duplicates.length===0,'Duplicate Production webhook subscriptions require owner-reviewed cleanup before release');const created=[];
  for(const topic of before.missing){const data=await graphQl(target,\`mutation ProInspectReleaseWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id topic uri } userErrors { field message } } }\`,{topic,webhookSubscription:{uri:target.webhookUri,format:'JSON'}},env);const result=data.webhookSubscriptionCreate;requireThat(result&&!result.userErrors?.length&&result.webhookSubscription?.id,'Shopify webhook creation failed for '+topic);created.push(result.webhookSubscription);}
  const after=await auditShopifySubscriptions(target,env);requireThat(after.missing.length===0&&after.duplicates.length===0,'Shopify Production webhook subscriptions remain incomplete or duplicated');return {created,configured:after.configured,legacySubscriptionsRetained:after.legacy,destructiveChanges:false};
}
`);

// 17. Production final verification must prove the exact live Google/Cloudflare/Appwrite deployment, not only latest-ready metadata.
replaceOne(`${pkg}/release.mjs`,
  "import { withAppwrite } from './appwrite-session.mjs';",
  "import { withAppwrite,ensureWebPlatform } from './appwrite-session.mjs';\nimport { appwriteSchemaAudit } from './adapters/appwrite-cli.mjs';");
replaceOne(`${pkg}/release.mjs`,
  "    if(id==='schema'){return withAppwrite(target.appwrite,resolve(releaseDirectory(),'schema'),appwriteScopes,(api)=>sourceSchema().then((schema)=>ensureSchema(api,schema,target.appwrite.databaseId)));}",
  "    if(id==='schema'){return withAppwrite(target.appwrite,resolve(releaseDirectory(),'schema'),appwriteScopes,async(api)=>{const schema=await sourceSchema();const installed=await ensureSchema(api,schema,target.appwrite.databaseId);const platform=await ensureWebPlatform(target.appwrite,target.web,resolve(releaseDirectory(),'schema'));return {...installed,platform};});}");
replaceOne(`${pkg}/release.mjs`,
  "  const shopify=await shopifyAudit(target.shopify);const subscriptions=await auditShopifySubscriptions(target.shopify);\n  return {appwrite,google,cloudflare:{accountId:target.cloudflare.accountId,workerName:target.cloudflare.workerName,currentDeploymentId:current.id,currentVersionId:singlePreviousVersion(current)},shopify,subscriptions};",
  "  const shopify=await shopifyAudit(target.shopify);const subscriptions=await auditShopifySubscriptions(target.shopify);requireThat(subscriptions.duplicates.length===0,'Duplicate Production Shopify webhook subscriptions require manual cleanup');\n  return {appwrite,google,cloudflare:{accountId:target.cloudflare.accountId,workerName:target.cloudflare.workerName,currentDeploymentId:current.id,currentVersionId:singlePreviousVersion(current)},shopify,subscriptions};");
replaceOne(`${pkg}/release.mjs`,
  "      requireStage('shopify',context,target,{exactConfig:true});const edge=await edgeAcceptance(target.web,context.commit);const shopify=await auditShopifySubscriptions(target.shopify);requireThat(shopify.missing.length===0,'Production Shopify subscriptions are incomplete after release');\n      const servicesState={};for(const name of services){const value=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));const env=value.spec?.template?.spec?.containers?.[0]?.env ?? [];const plain=Object.fromEntries(env.filter((item)=>Object.hasOwn(item,'value')).map((item)=>[item.name,item.value]));requireThat(value.status?.latestReadyRevisionName&&plain.APP_VERSION===context.commit&&plain.AUTH_PROVIDER==='appwrite'&&plain.APPWRITE_BACKEND_MODE==='appwrite','Production Cloud Run runtime differs from approved candidate');servicesState[name]=value.status.latestReadyRevisionName;}\n      return {status:'PRODUCTION_PROMOTED_AWAITING_OBSERVATION',edge,shopify,services:servicesState,legacyRetired:false};",
  "      const shopifyStage=requireStage('shopify',context,target,{exactConfig:true});const googleStage=requireStage('google',context,target,{exactConfig:true});const cloudflareStage=requireStage('cloudflare',context,target,{exactConfig:true});\n      const cfLive=await cfRequest(target.cloudflare,\`/workers/scripts/${target.cloudflare.workerName}/deployments\`);const cfCurrent=cfLive.deployments?.[0];requireThat(cfCurrent?.id===cloudflareStage.result.current?.id&&singlePreviousVersion(cfCurrent)===cloudflareStage.result.candidateVersion?.id,'Production Cloudflare traffic differs from the recorded promoted candidate');\n      const edge=await edgeAcceptance(target.web,context.commit,fetch,{expectedVersionId:cloudflareStage.result.candidateVersion.id,expectedVersionTag:cloudflareStage.result.candidateVersion.tag});const shopify=await auditShopifySubscriptions(target.shopify);requireThat(shopify.missing.length===0&&shopify.duplicates.length===0,'Production Shopify subscriptions are incomplete or duplicated after release');\n      const appwrite=await appwriteSchemaAudit(target,resolve(releaseDirectory(),'verify-appwrite'));requireThat(appwrite.errors.length===0&&appwrite.unavailable.length===0&&appwrite.bucketErrors.length===0&&appwrite.leastPrivilege&&appwrite.approvedKeys&&appwrite.registeredDomains,'Production Appwrite schema, keys or registered domain differ from the approved release');\n      const servicesState={};for(const name of services){const expected=googleStage.result.services.find((item)=>item.name===name);requireThat(expected?.deployedRevision&&expected?.image,'Recorded Google deployment is incomplete: '+name);const value=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));const container=value.spec?.template?.spec?.containers?.[0]??{};const env=container.env??[];const plain=Object.fromEntries(env.filter((item)=>Object.hasOwn(item,'value')).map((item)=>[item.name,item.value]));const active=(value.status?.traffic??[]).filter((item)=>Number(item.percent)>0);requireThat(value.status?.latestReadyRevisionName===expected.deployedRevision&&container.image===expected.image&&active.length===1&&active[0].revisionName===expected.deployedRevision&&Number(active[0].percent)===100&&plain.APP_VERSION===context.commit&&plain.AUTH_PROVIDER==='appwrite'&&plain.APPWRITE_BACKEND_MODE==='appwrite','Production Cloud Run live revision/image/traffic/runtime differs from the recorded candidate');servicesState[name]={revision:expected.deployedRevision,image:expected.image,traffic:100};}\n      return {status:'PRODUCTION_PROMOTED_AWAITING_OBSERVATION',edge,shopify,shopifyStage:shopifyStage.completedAt,appwrite,services:servicesState,cloudflare:{deploymentId:cfCurrent.id,versionId:cloudflareStage.result.candidateVersion.id},legacyRetired:false};");

// 18. Regression coverage for file limits, target replacement and Shopify duplicate detection.
write(`${pkg}/tests/final-review.test.mjs`, `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_BACKUP_FILE_BYTES } from '../actions/backup.mjs';
import { MAX_MIGRATION_FILE_BYTES } from '../actions/migrate.mjs';
import { runtimeArguments } from '../actions/google.mjs';
import { subscriptionState, requiredShopifyTopics } from '../actions/shopify-production.mjs';

const packageDir=resolve(import.meta.dirname,'..');
test('backup and migration bounds cover every configured Appwrite bucket',()=>{const buckets=JSON.parse(readFileSync(resolve(packageDir,'../../appwrite/buckets/buckets.json'),'utf8'));const max=Math.max(...buckets.map((bucket)=>bucket.maximumFileSize));assert(max<=MAX_BACKUP_FILE_BYTES);assert(max<=MAX_MIGRATION_FILE_BYTES);});
test('Google runtime deployment replaces env and secret sets',()=>{const target={appwrite:{endpoint:'https://syd.cloud.appwrite.io/v1',projectId:'p',databaseId:'proinspect_core'},google:{environment:'staging',projectId:'g-project',runtimeBindings:{api:{env:{AUTH_PROVIDER:'appwrite',APPWRITE_BACKEND_MODE:'appwrite'},secretRefs:{APPWRITE_API_KEY:'appwrite-api:1'}}}}};const args=runtimeArguments(target,'api','a'.repeat(40));assert(args.includes('--set-env-vars'));assert(args.includes('--set-secrets'));assert(!args.includes('--update-env-vars'));assert(!args.includes('--update-secrets'));const env=args[args.indexOf('--set-env-vars')+1];assert.match(env,/APP_ENV=staging/);assert.match(env,/GOOGLE_CLOUD_PROJECT=g-project/);});
test('Shopify state reports missing and duplicate canonical subscriptions',()=>{const target={webhookUri:'https://app.proinspect.com.au/api/v1/integrations/shopify/webhooks/proinspect'};const nodes=requiredShopifyTopics.map((topic,index)=>({id:'gid://shopify/WebhookSubscription/'+index,topic,uri:target.webhookUri}));assert.deepEqual(subscriptionState(nodes,target).missing,[]);const duplicate=subscriptionState([...nodes,{...nodes[0],id:'gid://shopify/WebhookSubscription/duplicate'}],target);assert.equal(duplicate.duplicates.length,1);const missing=subscriptionState(nodes.slice(1),target);assert.deepEqual(missing.missing,[requiredShopifyTopics[0]]);});
`);

// 19. Version and documentation.
const manifest=JSON.parse(read(`${pkg}/manifest.json`));manifest.version='2.6.0';manifest.finalReviewHardening=true;write(`${pkg}/manifest.json`,JSON.stringify(manifest,null,2));
appendOnce(`${pkg}/README.md`, '## V2.6 final release-candidate review', `## V2.6 final release-candidate review

The final release-candidate review closes several gaps that could otherwise produce misleading green evidence or incomplete deployment state. Permanent CI now validates all launch tests plus Development, Staging and Production Terraform roots. Backup and migration adapters support every currently configured Appwrite bucket up to a bounded 128 MiB. Migration rerun assertions now compare journals and live hashes instead of returning unconditional PASS.

Google Cloud deployment replaces the complete runtime env/Secret Manager binding set so stale Firebase-era configuration cannot survive an Appwrite cutover. Cloudflare disables workers.dev exposure when a custom domain is configured. Production verification is bound to the recorded Google revision/image/traffic set and Cloudflare deployment/version, and re-audits Appwrite schema, runtime keys and the registered web domain.

Appwrite schema installation now reconciles the approved web hostname and performs stricter drift checks for existing database, table and bucket definitions. Shopify Production webhook inventory is cursor-paginated, duplicate canonical subscriptions block release, and reconciliation remains additive rather than silently deleting legacy subscriptions. Appwrite MFA acceptance now exercises both TOTP and a recovery-code challenge.

These controls still do not convert legacy worker business logic. The workers gate remains responsible for proving no Firestore writeback and real Appwrite-backed job execution before release review can pass.`);

// 20. Permanent package CI must keep all of these protections alive after this one-time finalizer deletes itself.
write('.github/workflows/launch-package.yml', `name: Launch package validation
on:
  workflow_dispatch:
  push:
    branches: [feat/launch-readiness-installation-v2]
  pull_request:
    paths:
      - infrastructure/upgrades/launch-readiness-v2/**
      - infrastructure/launch-scenarios/**
      - infrastructure/terraform/**
      - docs/deployment/production-runbook.md
      - .github/workflows/launch-package.yml
      - package.json
concurrency:
  group: launch-package-\${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  source-snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Archive exact tracked source without credentials or local state
        run: git archive --format=zip HEAD -o "$RUNNER_TEMP/proinspect-source.zip"
      - uses: actions/upload-artifact@v4
        with:
          name: proinspect-source-\${{ github.sha }}
          path: \${{ runner.temp }}/proinspect-source.zip
          retention-days: 1
          if-no-files-found: error
  package:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22.23.2
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.15.0
          terraform_wrapper: false
      - name: Install dependencies
        run: npm ci --ignore-scripts --no-audit --no-fund
      - name: Syntax check launch modules
        run: find infrastructure/upgrades/launch-readiness-v2 infrastructure/launch-scenarios -name '*.mjs' -print0 | xargs -0 -n1 node --check
      - name: Validate Terraform module and all environments
        shell: bash
        run: |
          set -euo pipefail
          terraform fmt -check -recursive infrastructure/terraform
          terraform -chdir=infrastructure/terraform/modules/environment init -backend=false -input=false
          terraform -chdir=infrastructure/terraform/modules/environment validate
          rm -rf infrastructure/terraform/modules/environment/.terraform infrastructure/terraform/modules/environment/.terraform.lock.hcl
          for env in development staging production; do
            src="infrastructure/terraform/environments/$env"
            tmp="infrastructure/terraform/environments/.validate-$env"
            rm -rf "$tmp"
            cp -R "$src" "$tmp"
            rm -rf "$tmp/.terraform"
            python3 - "$tmp/main.tf" <<'PY'
          import re, sys
          path=sys.argv[1]
          text=open(path,encoding='utf-8').read()
          text,count=re.subn(r'\\n\\s*backend\\s+"gcs"\\s*\\{\\s*\\}\\s*', '\\n', text, count=1)
          if count != 1:
              raise SystemExit('expected exactly one empty gcs backend stanza')
          open(path,'w',encoding='utf-8').write(text)
          PY
            terraform -chdir="$tmp" init -backend=false -input=false -lockfile=readonly
            terraform -chdir="$tmp" validate
            rm -rf "$tmp"
          done
      - name: Repository validation
        run: npm run check
      - name: All launch package regression tests
        run: npm run launch:test
      - name: Exact package integrity
        run: npm run launch:audit
      - name: Development and Staging plan remains non-production
        run: npm run launch:plan
      - name: Production remains a separate release plan
        run: npm run launch:release -- plan
`);

console.log('Final V2.6 hardening patches staged.');
