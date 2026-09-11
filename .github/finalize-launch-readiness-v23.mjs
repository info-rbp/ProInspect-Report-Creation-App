import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const base='infrastructure/upgrades/launch-readiness-v2';
const read=(name)=>readFileSync(resolve(base,name),'utf8');
if(!read('README.md').includes('## V2.3 interrupted-deployment hardening')) appendFileSync(resolve(base,'README.md'),`\n\n## V2.3 interrupted-deployment hardening\n\nV2.3 adds crash reconciliation for migration journals, rollback-safe Appwrite runtime-key rotation, mandatory Terraform plan review, two-phase Cloud Run rollout, and guaranteed cleanup attempts for isolated restore probes.\n\nA migration entry left \`PENDING\` by interruption is reconciled against the live row/file. An exact match is promoted to \`CREATED\`; an absent object is retried; a differing object blocks as \`AMBIGUOUS_MIGRATION\`. Runtime keys rotate before unsafe expiry or scope drift while still-valid previous keys are retained as approved \`retiring\` keys for rollback until expiry.\n\nTerraform now writes private \`terraform-plan-review.json\` and blocks with \`TERRAFORM_REVIEW_REQUIRED:<digest>\` until \`LAUNCH_TERRAFORM_PLAN_SHA256\` contains that exact reviewed digest. A changed plan is refused. Google deployment creates and verifies all six Cloud Run revisions with zero traffic before switching any service. A traffic-phase failure attempts restoration of already-switched services. Restore probes attempt cleanup of every owned temporary bucket/database even when verification fails.\n`);
function files(prefix=''){return readdirSync(resolve(base,prefix),{withFileTypes:true}).flatMap((e)=>{const name=prefix?`${prefix}/${e.name}`:e.name;return e.isDirectory()?files(name):[name];}).sort();}
const index={algorithm:'sha256',files:{}};
for(const name of files().filter((name)=>name!=='integrity.json')) index.files[name]=createHash('sha256').update(readFileSync(resolve(base,name))).digest('hex');
writeFileSync(resolve(base,'integrity.json'),JSON.stringify(index,null,2)+'\n');
console.log(`Indexed ${Object.keys(index.files).length} package files`);
