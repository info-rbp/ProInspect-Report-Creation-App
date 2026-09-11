import { dirname, resolve } from 'node:path';
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
