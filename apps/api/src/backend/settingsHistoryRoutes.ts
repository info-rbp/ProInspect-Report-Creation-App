import type { IncomingMessage } from 'node:http';
import type { SettingsSection } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { recordSettingsVersion } from '../services/settingsHistoryService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function agencyHeader(req: IncomingMessage): string { const value=req.headers['x-agency-id']?.toString().trim(); if(!value)throw new ApiError(400,'AGENCY_HEADER_REQUIRED','x-agency-id is required.'); return value; }
async function listAll(dependencies:ApiDependencies,collection:string,agencyId:string):Promise<StoredRecord[]>{const values:StoredRecord[]=[];let cursor:string|undefined;do{const page=await dependencies.repository.list(collection,agencyId,100,cursor);values.push(...page.items);cursor=page.nextCursor;}while(cursor);return values;}

export async function routeSettingsHistoryRequest(req:IncomingMessage,dependencies:ApiDependencies,correlationId:string):Promise<ApiResponse|undefined>{
  const route=new URL(req.url??'/','http://localhost').pathname.split('/').filter(Boolean);
  if(route[0]!=='api'||route[1]!=='v1'||route[2]!=='settings'||route[3]!=='history')return undefined;
  const agencyId=agencyHeader(req);
  if(req.method==='GET'&&route.length===4){const principal=await authenticateAndAuthorise(req,dependencies,'settings.read',{agencyId},correlationId);const values=await listAll(dependencies,'settingsChangeHistory',agencyId);values.sort((a,b)=>String(b.changedAt||b.createdAt).localeCompare(String(a.changedAt||a.createdAt)));return{status:200,body:{data:values,meta:{actor:principal.uid,correlationId}}};}
  if(req.method==='GET'&&route[4]==='versions'){const principal=await authenticateAndAuthorise(req,dependencies,'settings.read',{agencyId},correlationId);const values=await listAll(dependencies,'settingsVersions',agencyId);return{status:200,body:{data:values.sort((a,b)=>String(b.changedAt||b.createdAt).localeCompare(String(a.changedAt||a.createdAt))),meta:{actor:principal.uid,correlationId}}};}
  if(req.method==='POST'&&route[4]==='restore'&&route[5]){
    const principal=await authenticateAndAuthorise(req,dependencies,'settings.security.manage',{agencyId},correlationId);
    const version=await dependencies.repository.get('settingsVersions',agencyId,decodeURIComponent(route[5]));if(!version)throw new ApiError(404,'SETTINGS_VERSION_NOT_FOUND','Settings version was not found.');
    const collection=String(version.sourceCollection||'');const recordId=String(version.sourceRecordId||'');if(!collection||!recordId||!version.snapshot||typeof version.snapshot!=='object')throw new ApiError(409,'SETTINGS_VERSION_INVALID','Stored settings version cannot be restored.');
    const current=await dependencies.repository.get(collection,agencyId,recordId);if(!current)throw new ApiError(404,'SETTINGS_RECORD_NOT_FOUND','Current settings record was not found.');
    const snapshot={...(version.snapshot as Record<string,unknown>)};delete snapshot.id;delete snapshot.version;delete snapshot.createdAt;delete snapshot.updatedAt;delete snapshot.agencyId;
    const restored=await dependencies.repository.update(collection,agencyId,recordId,snapshot,Number(current.version),principal.uid);
    const section = String(version.section || 'security') as SettingsSection;
    await recordSettingsVersion(dependencies,{agencyId,section,collection,recordId,before:current,after:restored,actorId:principal.uid,correlationId,reason:`restored_from_${version.id}`});
    return{status:200,body:{data:restored,meta:{actor:principal.uid,correlationId}}};
  }
  throw new ApiError(405,'METHOD_NOT_ALLOWED','Unsupported settings history operation.');
}
