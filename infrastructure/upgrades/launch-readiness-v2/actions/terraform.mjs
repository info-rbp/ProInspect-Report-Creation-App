import { resolve, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { root, run, readJson, hash, requireThat, atomicJson, canonical } from '../runtime.mjs';
import { googleIdentity } from './google.mjs';

export function validateTerraformPlan(plan,projectId) {
  requireThat(plan.errored !== true,'Terraform plan contains an error');
  for(const item of plan.resource_changes ?? []) {
    requireThat(!item.change.actions.includes('delete'),'Destructive Terraform deletion/replacement is blocked');
    const after=item.change.after;
    if(after?.project) requireThat(after.project===projectId,`Foreign project in ${item.address}`);
    if(after?.project_id) requireThat(after.project_id===projectId,`Foreign project ID in ${item.address}`);
    requireThat(!item.change.after_unknown?.project && !item.change.after_unknown?.project_id,'Unknown project target is blocked');
  }
  return true;
}
export function terraformReviewDigest(plan) {
  return hash(canonical({format_version:plan.format_version,terraform_version:plan.terraform_version,resource_changes:plan.resource_changes ?? [],output_changes:plan.output_changes ?? {}}));
}
export async function terraform(target,context,directory) {
  const expected=`infrastructure/terraform/environments/${context.environment}`;
  requireThat(target.terraform.root===expected,'Unexpected Terraform root');
  requireThat(isAbsolute(target.terraform.variablesFile ?? '') && isAbsolute(target.terraform.backendFile ?? ''),'Supply private absolute JSON tfvars/backend paths');
  const vars=readJson(target.terraform.variablesFile); const backend=readJson(target.terraform.backendFile);
  requireThat(vars.project_id===target.google.projectId && vars.region===target.google.region,'Terraform variables target mismatch');
  requireThat(typeof backend.bucket==='string' && typeof backend.prefix==='string' && backend.prefix.includes(context.environment),'Use an environment-isolated GCS state prefix');
  await googleIdentity(target.google);
  const cwd=resolve(root,expected); const planFile=resolve(directory,'terraform.plan');
  await run('terraform',['init','-input=false','-lockfile=readonly',`-backend-config=${target.terraform.backendFile}`],{cwd,live:true,sensitive:true});
  await run('terraform',['validate'],{cwd,live:false,logFile:resolve(directory,'terraform-validate.log')});
  await run('terraform',['plan','-input=false','-lock=true',`-var-file=${target.terraform.variablesFile}`,`-out=${planFile}`],{cwd,live:true,sensitive:true});
  const plan=JSON.parse(await run('terraform',['show','-json',planFile],{cwd,live:true,sensitive:true}));
  validateTerraformPlan(plan,target.google.projectId);
  const reviewSha256=terraformReviewDigest(plan);const binarySha256=hash(readFileSync(planFile));
  atomicJson(resolve(directory,'terraform-plan-review.json'),{candidate:context,reviewSha256,binarySha256,resourceChanges:plan.resource_changes ?? [],outputChanges:plan.output_changes ?? {}});
  requireThat(process.env.LAUNCH_TERRAFORM_PLAN_SHA256===reviewSha256,`TERRAFORM_REVIEW_REQUIRED:${reviewSha256}: inspect the private terraform-plan-review.json then export LAUNCH_TERRAFORM_PLAN_SHA256 with this exact digest and rerun the stage`);
  await googleIdentity(target.google); requireThat(hash(readFileSync(planFile))===binarySha256,'Terraform plan changed after approval check');
  await run('terraform',['apply','-input=false',planFile],{cwd,live:true,sensitive:true,timeoutMs:3600000});
  return {reviewSha256,binarySha256,applied:true,resources:plan.resource_changes?.length ?? 0};
}
