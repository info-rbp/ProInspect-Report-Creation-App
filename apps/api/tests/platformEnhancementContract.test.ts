import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, OperationalRepository, Page, ReportAggregateStore, StoredRecord } from '../src/backend/types.js';

let server: ReturnType<typeof createServer> | undefined;
afterEach(() => server?.close());

class MemoryRepository implements OperationalRepository {
  records = new Map<string, StoredRecord>();
  private key(c:string,a:string,i:string){ return `${c}:${a}:${i}`; }
  async list(collection:string, agencyId:string): Promise<Page<StoredRecord>> { return { items:[...this.records.entries()].filter(([k])=>k.startsWith(`${collection}:${agencyId}:`)).map(([,v])=>v) }; }
  async get(collection:string,agencyId:string,id:string){ return this.records.get(this.key(collection,agencyId,id)); }
  async create(collection:string,agencyId:string,id:string,data:Record<string,unknown>,actorId:string){ const now=new Date().toISOString(); const value={...data,id,agencyId,version:1,createdAt:now,updatedAt:now,createdBy:actorId}; this.records.set(this.key(collection,agencyId,id),value); return value; }
  async update(collection:string,agencyId:string,id:string,data:Record<string,unknown>,expectedVersion:number,actorId:string){ const existing=await this.get(collection,agencyId,id); if(!existing) throw Object.assign(new Error('Not found'),{status:404,code:'NOT_FOUND'}); const value={...existing,...data,version:expectedVersion+1,updatedBy:actorId}; this.records.set(this.key(collection,agencyId,id),value); return value; }
}

const reports: ReportAggregateStore = {
  load: async()=>undefined,
  saveDraft: async()=>{ throw new Error('not used'); },
  transition: async()=>{ throw new Error('not used'); },
};
function deps(): ApiDependencies {
  return {
    requireAppCheck:false,
    identityVerifier:{ verifyIdentityToken:async()=>({uid:'admin-1',agencyId:'agency-a',authTime:1,issuedAt:1,mfaVerified:true}), verifyAppCheckToken:async()=>undefined },
    memberships:{ getMembership:async()=>({uid:'admin-1',agencyId:'agency-a',role:'proinspect_admin',status:'active',mfaRequired:false,updatedAt:new Date().toISOString()}) },
    audit:{append:async()=>undefined}, repository:new MemoryRepository(), reports, idempotency:new MemoryIdempotencyStore(), tasks:{dispatch:async()=>undefined}, uploads:{create:async(agencyId,uploadId,input)=>({id:uploadId,agencyId,...input,status:'issued'})},
  };
}
async function request(path:string){
  server=createServer(createRequestHandler(deps())).listen(0); await new Promise<void>(r=>server?.once('listening',r));
  const address=server.address(); if(!address||typeof address==='string') throw new Error('Missing address');
  return fetch(`http://127.0.0.1:${address.port}${path}`,{headers:{authorization:'Bearer token','x-agency-id':'agency-a'}});
}

describe('platform route contracts',()=>{
  it('mounts the Inspection Planner collection endpoint',async()=>{
    const response=await request('/api/v1/inspection-route-plans');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({data:[]});
  });

  it.each(['/api/v1/jurisdiction-policies','/api/v1/document-packets','/api/v1/communication-threads','/api/v1/compliance-obligations','/api/v1/key-register','/api/v1/pms-connections','/api/v1/remote-inspection-assignments'])('mounts %s',async(path)=>{
    const response=await request(path);
    expect(response.status).not.toBe(404);
  });
});
