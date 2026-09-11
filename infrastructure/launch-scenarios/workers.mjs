import { Buffer } from 'node:buffer';
import { run, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { applyExternalChecks } from './common.mjs';
export async function runScenario(probe) {
  const target=probe.input.target; const map={ 'pdf_appwrite':'pdf-worker','notification_appwrite':'notification-worker','dashboard_appwrite':'dashboard-worker','document_appwrite':'document-worker','integration_appwrite':'integration-worker' }; const observations={};
  for(const [checkId,name] of Object.entries(map)){
    const state=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true})); requireThat(state.status?.latestReadyRevisionName,'Cloud Run service is not Ready: '+name);
    const env=state.spec?.template?.spec?.containers?.[0]?.env ?? []; const plain=Object.fromEntries(env.filter((v)=>Object.hasOwn(v,'value')).map((v)=>[v.name,v.value])); const names=env.map((v)=>v.name);
    const ok=plain.AUTH_PROVIDER==='appwrite' && plain.APPWRITE_BACKEND_MODE==='appwrite' && plain.APPWRITE_PROJECT_ID===target.appwrite.projectId && plain.APP_VERSION===probe.input.candidate.commit && names.includes('APPWRITE_API_KEY'); probe.check(checkId,ok,true); observations[name]={revision:state.status.latestReadyRevisionName,appwrite:ok};
  }
  applyExternalChecks(probe,probe.input,['poison_retry','idempotent','no_firebase_writes'],['automated-test','operations-rehearsal']);
  probe.artifact('workers-live.json',Buffer.from(JSON.stringify(observations)));
}
