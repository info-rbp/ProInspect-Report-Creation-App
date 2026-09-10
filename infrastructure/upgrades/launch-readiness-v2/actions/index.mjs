import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readJson,atomicJson,requireThat,hash } from '../runtime.mjs';
import { withAppwrite } from '../appwrite-session.mjs';
import { sourceSchema,ensureSchema } from './schema.mjs';
import { backup,restoreProbe } from './backup.mjs';
import { migrate,rollbackMigration } from './migrate.mjs';
import { deployGoogle,rollbackGoogle } from './google.mjs';
import { deployCloudflare,rollbackCloudflare } from './cloudflare.mjs';
import { terraform } from './terraform.mjs';
import { provisionCredentials } from './credentials.mjs';
import { validateSource } from './source.mjs';
import { replayShopify } from './shopify.mjs';
export const installationOrder=['source','backup','schema','data','files','terraform','credentials','google','cloudflare','shopify'];
const scopes=['databases.read','databases.write','tables.read','tables.write','columns.read','columns.write','indexes.read','indexes.write','rows.read','rows.write','buckets.read','buckets.write','files.read','files.write','teams.read','teams.write'];
export async function action(id,config,context,directory,stateDirectory,runId){
  const target=config.environments[context.environment];const app=target.appwrite;
  if(id==='source')return validateSource(context,directory);
  if(id==='terraform')return terraform(target,context,directory);
  if(id==='credentials')return provisionCredentials(config,context.environment,directory,resolve(stateDirectory,'config.json'));
  if(id==='google')return deployGoogle(target,context,directory);
  if(id==='cloudflare')return deployCloudflare(target,context,directory);
  if(id==='shopify')return replayShopify(target,directory);
  if(id==='rollback-google')return rollbackGoogle(target,target.rollback.googleRecord);
  if(id==='rollback-cloudflare')return rollbackCloudflare(target,target.rollback.cloudflareRecord);
  return withAppwrite(app,directory,scopes,async(api)=>{
    if(id==='backup'){
      const receipt=await backup(api,target,directory,runId);const restored=await restoreProbe(api,receipt,app,directory);
      atomicJson(resolve(stateDirectory,context.environment,'last-backup.json'),{...restored,candidate:context});return restored;
    }
    if(id==='schema'){
      const schema=await sourceSchema();return ensureSchema(api,schema,app.databaseId);
    }
    if(['data','files'].includes(id))return migrate(api,target,resolve(stateDirectory,context.environment),id);
    if(id==='rollback-migration'){
      requireThat(target.backup.freezeApproved && target.migration.rollbackApproved===true,'Rollback needs a write freeze and explicit ownership review');
      return rollbackMigration(api,target,resolve(stateDirectory,context.environment));
    }
    throw new Error(`Unknown action ${id}`);
  });
}
export function requireBackup(stateDirectory,context){
  const record=readJson(resolve(stateDirectory,context.environment,'last-backup.json'));
  requireThat(record.restored===true && record.candidate.commit===context.commit && record.candidate.configHash===context.configHash,'Run backup/restore on this exact candidate/configuration first');
  requireThat(Date.now()-Date.parse(record.completedAt)<3600000,'Backup is more than one hour old; freeze writers and repeat');
  requireThat(hash(readFileSync(resolve(record.directory,'index.enc')))===record.indexSha256,'Backup index changed');
  return record;
}
