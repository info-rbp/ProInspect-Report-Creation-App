import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg='infrastructure/upgrades/launch-readiness-v2';
const scenario='infrastructure/launch-scenarios';
const read=(path)=>readFileSync(path,'utf8');
const write=(path,value)=>writeFileSync(path,value);
function prepend(path,line){const value=read(path);if(!value.startsWith(line))write(path,`${line}\n${value}`);}
function replaceAll(path,before,after){const value=read(path);if(!value.includes(before))throw new Error(`Expected generated text missing in ${path}: ${before}`);write(path,value.split(before).join(after));}

prepend(`${scenario}/common.mjs`,"import { Buffer } from 'node:buffer';");
replaceAll(`${scenario}/common.mjs`,'AbortSignal.timeout(30000)','globalThis.AbortSignal.timeout(30000)');
replaceAll(`${scenario}/common.mjs`,"import { hash, readJson, requireThat, safePath } from '../upgrades/launch-readiness-v2/runtime.mjs';","import { canonical, hash, readJson, requireThat, safePath } from '../upgrades/launch-readiness-v2/runtime.mjs';");
replaceAll(`${scenario}/common.mjs`,'requireThat(JSON.stringify(bundle.targets) === JSON.stringify(providerTargets(input)),','requireThat(canonical(bundle.targets) === canonical(providerTargets(input)),');

for(const name of ['commerce-calendar.mjs','identity.mjs','migration.mjs','operations.mjs','recovery.mjs','rehearsal.mjs','workers.mjs']) prepend(`${scenario}/${name}`,"import { Buffer } from 'node:buffer';");
replaceAll(`${scenario}/identity.mjs`,'await delay(1000);',"const nextWindowDelay=30000-(Date.now()%30000)+750; await delay(nextWindowDelay);");
replaceAll(`${scenario}/migration.mjs`,"import { hash, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';","import { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';");
replaceAll(`${scenario}/migration.mjs`,"import { actionState, stateEnvironmentDirectory } from './common.mjs';","import { applyExternalChecks, stateEnvironmentDirectory } from './common.mjs';");
replaceAll(`${scenario}/migration.mjs`,'structuredClone(bundle)','JSON.parse(JSON.stringify(bundle))');
replaceAll(`${scenario}/migration.mjs`,'structuredClone(dupe.rows[0])','JSON.parse(JSON.stringify(dupe.rows[0]))');
replaceAll(`${scenario}/migration.mjs`,"  probe.check('source_count', bundle.rows.length >= 0, true);\n",'');
replaceAll(`${scenario}/migration.mjs`,"  const rollback = actionState('rollback-migration'); probe.check('rollback_rehearsal', rollback?.status==='SUCCEEDED' && rollback.result?.rolledBack===true, true);\n  probe.artifact('migration-live.json', Buffer.from(JSON.stringify({ rows:bundle.rows.length,dispositions:dispositions.length,counts,checksums,rollback:rollback?.completedAt ?? null,bundleDirectory:privateDirectory(target.migration.bundleDirectory) ? '[private]' : null })));","  const external=applyExternalChecks(probe,probe.input,['source_count','rollback_rehearsal'],['migration-rehearsal','automated-test']);\n  probe.artifact('migration-live.json', Buffer.from(JSON.stringify({ rows:bundle.rows.length,dispositions:dispositions.length,counts,checksums,rollbackObservedAt:external?.observedAt ?? null,bundleDirectory:privateDirectory(target.migration.bundleDirectory) ? '[private]' : null })));" );

const tests=`${pkg}/tests/installer.test.mjs`;
replaceAll(tests,"assert(!coverage.implemented.some((v)=>v.gate==='appwrite'));","assert(coverage.implemented.some((v)=>v.gate==='appwrite'));" );

const integrity={algorithm:'sha256',files:{}};
function files(prefix=''){return readdirSync(resolve(pkg,prefix),{withFileTypes:true}).flatMap((entry)=>{const name=prefix?`${prefix}/${entry.name}`:entry.name;return entry.isDirectory()?files(name):[name];}).sort();}
for(const name of files().filter((name)=>name!=='integrity.json'))integrity.files[name]=createHash('sha256').update(readFileSync(resolve(pkg,name))).digest('hex');
writeFileSync(resolve(pkg,'integrity.json'),`${JSON.stringify(integrity,null,2)}\n`);
console.log('Normalized generated launch scenarios and regenerated integrity.');
