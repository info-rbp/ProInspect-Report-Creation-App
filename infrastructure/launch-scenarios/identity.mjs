import { Buffer } from 'node:buffer';
import { randomUUID, createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, AuthenticationFactor, AuthenticatorType, Client, Query } from 'node-appwrite';
import { withAppwrite } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { applyExternalChecks, authenticate, expectDenied, portals, requiredSecret, userTables } from './common.mjs';

function base32Bytes(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const clean = secret.toUpperCase().replaceAll('=', '').replace(/[^A-Z2-7]/gu, ''); let bits = '';
  for (const character of clean) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = []; for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2)); return Buffer.from(bytes);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 30000); const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Bytes(secret)).update(message).digest(); const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
export async function runScenario(probe) {
  const app = probe.input.target.appwrite; const password = requiredSecret(probe.input.target, 'seedPasswordEnv'); const services = {};
  for (const [portal, userId] of portals) {
    const tables = userTables(app, await authenticate(app, userId, password)); services[portal] = tables;
    const entitlements = await tables.listRows({ databaseId:app.databaseId,tableId:'portal_entitlements',queries:[Query.equal('userId',[userId]),Query.equal('portalId',[portal]),Query.equal('status',['active']),Query.limit(10)] });
    if (entitlements.total !== 1) throw new Error(userId + ' does not have exactly one active ' + portal + ' entitlement');
  }
  probe.check('all_seven_portals', Object.keys(services).sort(), portals.map(([id]) => id).sort());
  probe.check('cross_agency_site_denial', await expectDenied(() => services.building.getRow({ databaseId:app.databaseId,tableId:'managed_sites',rowId:'dev_site_commercial' })), true);
  const assignmentDenied = await expectDenied(() => services.contractor.getRow({ databaseId:app.databaseId,tableId:'inspection_jobs',rowId:'dev_inspection_job' })) && await expectDenied(() => services.inspector.getRow({ databaseId:app.databaseId,tableId:'maintenance_work_orders',rowId:'dev_work_order' }));
  probe.check('inspector_contractor_assignment_denial', assignmentDenied, true);
  let sessionRevoked = false; let mfaPassed = false;
  await withAppwrite(app, process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0, process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')), ['users.read','users.write'], async (api) => {
    const userId = 'accept_mfa_' + randomUUID().replaceAll('-','').slice(0,16); const email = userId + '@example.com';
    try {
      await api.users.create({ userId, email, password, name:'ACCEPTANCE MFA probe' });
      const session = await authenticate(app,userId,password); const account = new Account(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(session));
      const authenticator = await account.createMFAAuthenticator({ type:AuthenticatorType.Totp });
      await account.updateMFAAuthenticator({ type:AuthenticatorType.Totp, otp:totp(authenticator.secret) }); await account.updateMFA({ mfa:true });
      const recovery = await account.createMFARecoveryCodes(); if (!recovery.recoveryCodes?.length) throw new Error('MFA recovery codes were not created');
      await api.users.deleteSessions({ userId });
      sessionRevoked = await expectDenied(() => account.get());
      const nextWindowDelay=30000-(Date.now()%30000)+750; await delay(nextWindowDelay);
      const challengeSession = await authenticate(app,userId,password); const challengeAccount = new Account(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(challengeSession));
      const challenge = await challengeAccount.createMFAChallenge({ factor:AuthenticationFactor.Totp }); await challengeAccount.updateMFAChallenge({ challengeId:challenge.$id,otp:totp(authenticator.secret) });
      const verified = await challengeAccount.getSession({ sessionId:'current' }); mfaPassed = verified.factors?.includes('totp') === true;
    } finally { await api.users.delete({ userId }).catch(() => {}); }
  });
  probe.check('mfa_challenge_recovery', mfaPassed, true); probe.check('session_revocation', sessionRevoked, true);
  applyExternalChecks(probe, probe.input, ['email_verification_recovery','relief_expiry','stale_occupancy_denial','multi_portal_identity'], ['automated-test']);
  probe.artifact('identity-live.json', Buffer.from(JSON.stringify({ portals:portals.map(([id,userId])=>({id,userId})),mfaPassed,sessionRevoked,assignmentDenied })));
}
