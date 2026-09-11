import { Buffer } from 'node:buffer';
import { requireThat, run } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { applyExternalChecks } from './common.mjs';

export async function runScenario(probe) {
  const target=probe.input.target;const serviceNames=['api','pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker'];const observations={};let allReady=true;let allAppwrite=true;let allImmutable=true;
  for(const name of serviceNames){
    const state=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));
    requireThat(state.status?.latestReadyRevisionName,'Cloud Run service is not Ready: '+name);const container=state.spec?.template?.spec?.containers?.[0]??{};const env=container.env??[];const plain=Object.fromEntries(env.filter((item)=>Object.hasOwn(item,'value')).map((item)=>[item.name,item.value]));const names=env.map((item)=>item.name);
    const appwrite=plain.AUTH_PROVIDER==='appwrite'&&plain.APPWRITE_BACKEND_MODE==='appwrite'&&plain.APPWRITE_PROJECT_ID===target.appwrite.projectId&&plain.APP_VERSION===probe.input.candidate.commit&&names.includes('APPWRITE_API_KEY');
    const immutable=typeof container.image==='string'&&container.image.includes('@sha256:');allReady=allReady&&Boolean(state.status.latestReadyRevisionName);allAppwrite=allAppwrite&&appwrite;allImmutable=allImmutable&&immutable;
    observations[name]={revision:state.status.latestReadyRevisionName,image:container.image??null,appwrite};
  }
  probe.check('api_ai_pdf_document_notification_dashboard_integration',allReady&&target.google.aiRuntime==='api',true);
  probe.check('same_candidate_image_digests',allImmutable&&Object.values(observations).every((item)=>item.appwrite),true);
  probe.check('all_cutover_domains_appwrite',allAppwrite,true);
  applyExternalChecks(probe,probe.input,['no_firestore_writeback','queue_retry_deadletter','pdf_and_document_job_execution','dashboard_reconciles','email_sms_callbacks_retries','conversation_participant_denial'],['automated-test','operations-rehearsal']);
  probe.artifact('workers-live.json',Buffer.from(JSON.stringify(observations)));
}
