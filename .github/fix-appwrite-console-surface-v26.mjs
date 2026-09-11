import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot='infrastructure/upgrades/launch-readiness-v2';
const files=[`${packageRoot}/appwrite-session.mjs`,`${packageRoot}/actions/credentials.mjs`,`${packageRoot}/adapters/appwrite-cli.mjs`];
for(const path of files){
  let value=readFileSync(path,'utf8');
  value=value.replaceAll("['project','get'","['projects','get'")
    .replaceAll("['project','create-key'","['projects','create-key'")
    .replaceAll("['project','delete-key'","['projects','delete-key'")
    .replaceAll("['project','list-keys'","['projects','list-keys'")
    .replaceAll("['project','list-platforms'","['projects','list-platforms'")
    .replaceAll("['project','create-platform'","['projects','create-platform'");
  writeFileSync(path,value);
}

const testPath=`${packageRoot}/tests/final-review.test.mjs`;
let test=readFileSync(testPath,'utf8');
if(!test.includes("Appwrite console administration uses the projects CLI service")){
  test += `\ntest('Appwrite console administration uses the projects CLI service',()=>{for(const relative of ['appwrite-session.mjs','actions/credentials.mjs','adapters/appwrite-cli.mjs']){const source=readFileSync(resolve(packageDir,relative),'utf8');assert(!source.includes(\"['project','get'\"));assert(!source.includes(\"['project','create-key'\"));assert(!source.includes(\"['project','delete-key'\"));assert(!source.includes(\"['project','list-keys'\"));assert(!source.includes(\"['project','list-platforms'\"));assert(!source.includes(\"['project','create-platform'\"));}const session=readFileSync(resolve(packageDir,'appwrite-session.mjs'),'utf8');assert(session.includes(\"['projects','get'\"));assert(session.includes(\"['projects','create-key'\"));assert(session.includes(\"['projects','list-platforms'\"));});\n`;
  writeFileSync(testPath,test);
}

const readme=`${packageRoot}/README.md`;
let docs=readFileSync(readme,'utf8');
const note='Appwrite console CLI surface correction';
if(!docs.includes(note)) docs += `\n### ${note}\n\nV2.6 uses the authenticated Appwrite CLI \`projects\` service for project identity, platform and API-key administration. The singular \`project\` service is not used for these console-level operations. The installer still refuses a standing \`APPWRITE_API_KEY\` and creates only bounded temporary/runtime credentials after verifying the exact target project.\n`;
writeFileSync(readme,docs);

function packageFiles(prefix=''){return readdirSync(resolve(packageRoot,prefix),{withFileTypes:true}).flatMap((entry)=>{const name=prefix?`${prefix}/${entry.name}`:entry.name;return entry.isDirectory()?packageFiles(name):[name];}).sort();}
const index={algorithm:'sha256',files:{}};
for(const name of packageFiles().filter((name)=>name!=='integrity.json'))index.files[name]=createHash('sha256').update(readFileSync(resolve(packageRoot,name))).digest('hex');
writeFileSync(resolve(packageRoot,'integrity.json'),JSON.stringify(index,null,2)+'\n');
console.log('Appwrite console CLI administration corrected to projects service.');
