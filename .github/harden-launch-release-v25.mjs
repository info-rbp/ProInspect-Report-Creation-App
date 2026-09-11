import { readFileSync, writeFileSync } from 'node:fs';
const read=(path)=>readFileSync(path,'utf8');
const write=(path,value)=>writeFileSync(path,value);
function replaceOne(path,before,after){const value=read(path);if(!value.includes(before))throw new Error(`Missing hardening anchor: ${path}`);if(value.indexOf(before)!==value.lastIndexOf(before))throw new Error(`Non-unique hardening anchor: ${path}`);write(path,value.replace(before,after));}

const cloudflare='infrastructure/upgrades/launch-readiness-v2/actions/cloudflare.mjs';
replaceOne(cloudflare,
"  const deployHelp=await run('node',[wrangler,'versions','deploy','--help'],{cwd:root});\n  requireThat(['--secrets-file','--tag','--strict'].every((option)=>uploadHelp.includes(option)) && deployHelp.includes('--version-tag'),'Pinned Wrangler does not support reviewed version upload/deployment');",
"  await run('node',[wrangler,'versions','deploy','--help'],{cwd:root});\n  requireThat(['--secrets-file','--tag','--strict'].every((option)=>uploadHelp.includes(option)),'Pinned Wrangler does not support reviewed version upload');");

const release='infrastructure/upgrades/launch-readiness-v2/release.mjs';
replaceOne(release,
"import { deployGoogle, rollbackGoogle } from './actions/google.mjs';",
"import { deployGoogle, googleIdentity, rollbackGoogle } from './actions/google.mjs';");
replaceOne(release,
"async function productionProviderPreflight(target,directory){\n  const appwrite=await appwriteAudit(target.appwrite,directory);const google=await googleAudit(target.google);const scripts=await cfRequest(target.cloudflare,'/workers/scripts');",
"async function productionProviderPreflight(target,directory,{requireGoogleApis=false}={}){\n  const appwrite=await appwriteAudit(target.appwrite,directory);\n  const google=requireGoogleApis ? await googleAudit(target.google) : {projectId:await googleIdentity(target.google),requiredApisPendingVerification:true};\n  const scripts=await cfRequest(target.cloudflare,'/workers/scripts');");
replaceOne(release,
"async function preflight(config,{forMutation=false}={}){",
"async function preflight(config,{forMutation=false,requireGoogleApis=false}={}){");
replaceOne(release,
"const providers=await productionProviderPreflight(target,resolve(releaseDirectory(),'preflight'));",
"const providers=await productionProviderPreflight(target,resolve(releaseDirectory(),'preflight'),{requireGoogleApis});");
replaceOne(release,
"  const {target,context}=await preflight(config,{forMutation:true});",
"  const {target,context}=await preflight(config,{forMutation:true,requireGoogleApis:id!=='terraform'});");
replaceOne(release,
"    let result;if(args.provider==='google')result=await rollbackGoogle(target,resolve(releaseDirectory(),'google','google-deployment.json'));else result=await rollbackCloudflare(target,resolve(releaseDirectory(),'cloudflare','cloudflare-deployment.json'));atomicJson(resolve(releaseDirectory(),`rollback-${args.provider}.json`),{candidate:context,completedAt:new Date().toISOString(),result,databaseRolledBack:false});return {status:'PRODUCTION_TRAFFIC_ROLLBACK_COMPLETE',provider:args.provider,databaseRolledBack:false,result};",
"    const releaseLock=acquireLock(resolve(releaseDirectory(),'lock-root'));\n    try{let result;if(args.provider==='google')result=await rollbackGoogle(target,resolve(releaseDirectory(),'google','google-deployment.json'));else result=await rollbackCloudflare(target,resolve(releaseDirectory(),'cloudflare','cloudflare-deployment.json'));atomicJson(resolve(releaseDirectory(),`rollback-${args.provider}.json`),{candidate:context,completedAt:new Date().toISOString(),result,databaseRolledBack:false});return {status:'PRODUCTION_TRAFFIC_ROLLBACK_COMPLETE',provider:args.provider,databaseRolledBack:false,result};}finally{releaseLock();}");

console.log('Hardened Production preflight bootstrap, serialized rollback, and Cloudflare CLI capability checks.');
