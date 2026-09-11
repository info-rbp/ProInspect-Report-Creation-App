import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, requireThat } from '../runtime.mjs';

export const workerServices=['pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker'];
const forbiddenRuntimePackages=new Set(['firebase','firebase-admin','@google-cloud/firestore','@google-cloud/storage']);
const forbiddenSource=[
  {id:'firebase-admin',pattern:/['"]firebase-admin(?:\/[^'"]*)?['"]/u},
  {id:'google-firestore',pattern:/['"]@google-cloud\/firestore['"]/u},
  {id:'google-storage',pattern:/['"]@google-cloud\/storage['"]/u},
  {id:'firestore-helper',pattern:/from\s+['"].*firestoreDatabase(?:\.js|\.ts)?['"]/u},
];
const sourceExtensions=new Set(['.js','.mjs','.cjs','.ts','.tsx']);
function walk(directory){if(!existsSync(directory))return [];return readdirSync(directory).flatMap((name)=>{const path=resolve(directory,name);const stat=statSync(path);if(stat.isDirectory())return name==='node_modules'||name==='dist'||name==='coverage'||name==='__tests__'?[]:walk(path);return [path];});}
function isRuntimeSource(path){const name=path.split('/').at(-1)??'';return sourceExtensions.has(extname(path))&&!/(?:^|\.)(?:test|spec)\.[^.]+$/u.test(name)&&!name.endsWith('.d.ts');}
export function inspectWorkerAuthority(base=root,services=workerServices){
  const violations=[];
  for(const service of services){
    const packagePath=resolve(base,'apps',service,'package.json');
    if(!existsSync(packagePath)){violations.push({service,path:relative(base,packagePath),reason:'missing-package'});continue;}
    const manifest=JSON.parse(readFileSync(packagePath,'utf8'));
    for(const name of Object.keys(manifest.dependencies??{}))if(forbiddenRuntimePackages.has(name))violations.push({service,path:relative(base,packagePath),reason:'forbidden-runtime-dependency:'+name});
    for(const path of walk(resolve(base,'apps',service,'src')).filter(isRuntimeSource)){
      const source=readFileSync(path,'utf8');
      for(const rule of forbiddenSource)if(rule.pattern.test(source))violations.push({service,path:relative(base,path),reason:'forbidden-runtime-import:'+rule.id});
    }
  }
  return {authority:'appwrite',services:[...services],violations,pass:violations.length===0};
}
export function inspectTerraformAuthority(base=root){
  const directory=resolve(base,'infrastructure/terraform/modules/environment');
  const violations=[];
  for(const path of walk(directory).filter((item)=>item.endsWith('.tf'))){
    const source=readFileSync(path,'utf8');
    const rules=[
      ['datastore-runtime-role',/roles\/datastore\.user/u],
      ['application-gcs-assets',/resource\s+"google_storage_bucket"\s+"assets"/u],
      ['application-gcs-reports',/resource\s+"google_storage_bucket"\s+"reports"/u],
      ['document-bucket-runtime',/name\s*=\s*"DOCUMENT_BUCKET"/u],
      ['report-bucket-runtime',/name\s*=\s*"REPORT_BUCKET"/u],
      ['firestore-resource',/resource\s+"google_firestore_/u],
    ];
    for(const [id,pattern] of rules)if(pattern.test(source))violations.push({path:relative(base,path),reason:id});
  }
  return {authority:'google-compute-only',violations,pass:violations.length===0};
}
export function inspectTargetAuthority(base=root,services=workerServices){const workers=inspectWorkerAuthority(base,services);const terraform=inspectTerraformAuthority(base);return {workers,terraform,pass:workers.pass&&terraform.pass};}
export function assertTargetAuthority(base=root,services=workerServices){const result=inspectTargetAuthority(base,services);const detail=[...result.workers.violations,...result.terraform.violations].map((v)=>v.path+':'+v.reason).join('; ');requireThat(result.pass,'BLOCKED_LEGACY_RUNTIME: '+detail);return result;}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=inspectTargetAuthority(root);console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
}
