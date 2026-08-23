import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../src/security/authoriseRequest.js';
import type { SecurityDependencies } from '../src/security/types.js';

function request(headers: Record<string,string> = {}): IncomingMessage {
  return { headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

function dependencies(input: { agencyId?: string; membership?: 'active' | 'missing' }): SecurityDependencies {
  return {
    requireAppCheck:false,
    identityVerifier:{
      verifyIdentityToken:async()=>({uid:'user-1', ...(input.agencyId ? {agencyId:input.agencyId} : {}), authTime:1, issuedAt:1, mfaVerified:true}),
      verifyAppCheckToken:async()=>undefined,
    },
    memberships:{
      getMembership:async(_uid,agencyId)=> input.membership === 'active'
        ? {uid:'user-1',agencyId,role:'proinspect_admin',status:'active',mfaRequired:false,updatedAt:new Date().toISOString()}
        : undefined,
    },
    audit:{append:async()=>undefined},
  };
}

describe('authorization contracts',()=>{
  it('does not invent agency-1 when neither identity nor request supplies an agency',async()=>{
    await expect(authenticateAndAuthorise(request({authorization:'Bearer token'}), dependencies({membership:'active'}), 'agency.read', {}, 'correlation-1'))
      .rejects.toMatchObject({code:'AGENCY_REQUIRED',status:403});
  });

  it('does not manufacture an administrator when membership is absent',async()=>{
    await expect(authenticateAndAuthorise(request({authorization:'Bearer token','x-agency-id':'agency-a'}), dependencies({membership:'missing'}), 'agency.read', {agencyId:'agency-a'}, 'correlation-2'))
      .rejects.toMatchObject({code:'MEMBERSHIP_INACTIVE',status:403});
  });

  it('authorizes an explicitly active membership',async()=>{
    const principal=await authenticateAndAuthorise(request({authorization:'Bearer token','x-agency-id':'agency-a'}), dependencies({membership:'active'}), 'agency.read', {agencyId:'agency-a'}, 'correlation-3');
    expect(principal).toMatchObject({uid:'user-1',agencyId:'agency-a',role:'proinspect_admin'});
  });
});
