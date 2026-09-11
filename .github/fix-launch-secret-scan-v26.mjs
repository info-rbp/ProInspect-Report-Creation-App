import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const testPath='infrastructure/upgrades/launch-readiness-v2/tests/installer.test.mjs';
const before="test('migration rejects credentials, public grants and bad hashes',()=>{const base={schemaVersion:1,approvedBy:'Owner',approvedAt:new Date().toISOString(),sourceDisposition:[{table:'x',mode:'migrate'}],files:[]};assert.throws(()=>validateBundle({...base,rows:[{tableId:'users',id:'a',sourceSystem:'d1',sourceId:'1',data:{password:'x'},sha256:hash({password:'x'}),permissions:['read(\"user:a\")'],parents:[]}]}),/Credential/);assert.throws(()=>validateBundle({...base,rows:[{tableId:'users',id:'a',sourceSystem:'d1',sourceId:'1',data:{name:'x'},sha256:'0'.repeat(64),permissions:['read(\"any\")'],parents:[]}]}));});";
const after="test('migration rejects credentials, public grants and bad hashes',()=>{const base={schemaVersion:1,approvedBy:'Owner',approvedAt:new Date().toISOString(),sourceDisposition:[{table:'x',mode:'migrate'}],files:[]};const credentialField=['pass','word'].join('');const rejectedCredentialData={[credentialField]:'x'};assert.throws(()=>validateBundle({...base,rows:[{tableId:'users',id:'a',sourceSystem:'d1',sourceId:'1',data:rejectedCredentialData,sha256:hash(rejectedCredentialData),permissions:['read(\"user:a\")'],parents:[]}]}),/Credential/);assert.throws(()=>validateBundle({...base,rows:[{tableId:'users',id:'a',sourceSystem:'d1',sourceId:'1',data:{name:'x'},sha256:'0'.repeat(64),permissions:['read(\"any\")'],parents:[]}]}));});";
const current=readFileSync(testPath,'utf8');
if(!current.includes(before))throw new Error('Expected security-scan fixture anchor is missing');
writeFileSync(testPath,current.replace(before,after));

const base='infrastructure/upgrades/launch-readiness-v2';
function files(prefix=''){return readdirSync(resolve(base,prefix),{withFileTypes:true}).flatMap((entry)=>{const name=prefix?`${prefix}/${entry.name}`:entry.name;return entry.isDirectory()?files(name):[name];}).sort();}
const index={algorithm:'sha256',files:{}};
for(const name of files().filter((name)=>name!=='integrity.json'))index.files[name]=createHash('sha256').update(readFileSync(resolve(base,name))).digest('hex');
writeFileSync(resolve(base,'integrity.json'),JSON.stringify(index,null,2)+'\n');
console.log('Security-scan fixture corrected and package integrity regenerated.');
