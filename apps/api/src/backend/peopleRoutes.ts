import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { roleCapabilities, type PeopleDirectoryEntry, type PeopleInvitation, type WorkforceProfile } from '@pcr/domain';
import { parseChangeRoleInput, parseInvitePersonInput, parseMembershipActionInput } from '@pcr/validation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import type { ApiDependencies } from './types.js';
import { ApiError, type ApiResponse } from './router.js';

function adminApp() { return getApps()[0] ?? initializeApp({ credential: applicationDefault() }); }
function agencyId(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); }
}
function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
async function appendAudit(deps: ApiDependencies, principal: { uid: string; role: string; agencyId: string }, capability: any, eventType: string, entityId: string, correlationId: string, metadata?: Record<string, unknown>) {
  await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId: principal.agencyId, capability, outcome: 'allowed', reason: `material_action:${eventType}`, target: { agencyId: principal.agencyId }, correlationId, eventType, entityType: 'user', entityId, ...(metadata ? { metadata } : {}) });
}
async function listDirectory(agency: string): Promise<PeopleDirectoryEntry[]> {
  const db = getFirestore(adminApp());
  const [membershipSnapshot, workforceSnapshot] = await Promise.all([
    db.collection(`agencies/${agency}/memberships`).get(),
    db.collection(`agencies/${agency}/workforceProfiles`).get(),
  ]);
  const workforce = new Map(workforceSnapshot.docs.map((doc) => [String(doc.data().userId), { id: doc.id, ...doc.data() } as WorkforceProfile]));
  const auth = getAuth(adminApp());
  return Promise.all(membershipSnapshot.docs.map(async (doc) => {
    const membership = doc.data() as any;
    let identity: any;
    try { const user = await auth.getUser(doc.id); identity = { uid: user.uid, email: user.email ?? membership.email ?? '', displayName: user.displayName, phone: user.phoneNumber, emailVerified: user.emailVerified, disabled: user.disabled, lastSignInAt: user.metadata.lastSignInTime, createdAt: user.metadata.creationTime }; }
    catch { identity = undefined; }
    return {
      id: doc.id,
      agencyId: agency,
      email: identity?.email ?? membership.email ?? '',
      displayName: membership.displayName ?? identity?.displayName,
      role: membership.role,
      membershipStatus: membership.status,
      mfaRequired: membership.mfaRequired === true,
      effectiveCapabilities: [...roleCapabilities(membership.role)],
      ...(identity ? { identity } : {}),
      ...(workforce.has(doc.id) ? { workforceProfile: workforce.get(doc.id) } : {}),
      ...(membership.invitationExpiresAt ? { invitationExpiresAt: membership.invitationExpiresAt } : {}),
      updatedAt: membership.updatedAt ?? new Date(0).toISOString(),
      version: membership.version ?? 1,
    } as PeopleDirectoryEntry;
  }));
}
async function countActiveAdmins(agency: string): Promise<number> {
  const snapshot = await getFirestore(adminApp()).collection(`agencies/${agency}/memberships`).where('status', '==', 'active').get();
  return snapshot.docs.filter((doc) => ['proinspect_admin', 'super_admin'].includes(String(doc.data().role))).length;
}
async function impact(agency: string, uid: string) {
  const db = getFirestore(adminApp());
  const [jobs, reports, maintenance] = await Promise.all([
    db.collection(`agencies/${agency}/inspectionJobs`).get(),
    db.collection(`agencies/${agency}/reports`).get(),
    db.collection(`agencies/${agency}/maintenanceItems`).get(),
  ]);
  const activeJobIds = jobs.docs.filter((d) => { const x = d.data(); return !['finalised','archived','cancelled'].includes(String(x.status)) && [x.assignedInspectorId, x.assignedAnalystId, x.assignedReviewerId].includes(uid); }).map((d) => d.id);
  const activeReportIds = reports.docs.filter((d) => { const x = d.data(); return !['finalised','archived','cancelled'].includes(String(x.lifecycleStatus)) && [x.assignedInspectorId, x.assignedAnalystId, x.assignedReviewerId].includes(uid); }).map((d) => d.id);
  const activeMaintenanceItemIds = maintenance.docs.filter((d) => { const x = d.data(); return !['closed','cancelled','completed'].includes(String(x.status)) && [x.assignedUserId, x.assignedTo].includes(uid); }).map((d) => d.id);
  return { userId: uid, activeInspectionJobIds: activeJobIds, activeReportIds, activeMaintenanceItemIds, totalImpactedAssignments: activeJobIds.length + activeReportIds.length + activeMaintenanceItemIds.length };
}

export async function routePeopleRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const p = parts(req); if (p[0] !== 'api' || p[1] !== 'v1' || p[2] !== 'people') return undefined;
  const agency = agencyId(req); const uid = p[3]; const action = p[4];

  if (req.method === 'GET' && !uid) {
    const principal = await authenticateAndAuthorise(req, deps, 'user.read', { agencyId: agency }, correlationId);
    return { status: 200, body: { data: await listDirectory(agency), meta: { correlationId, actor: principal.uid } } };
  }
  if (req.method === 'GET' && uid && action === 'impact') {
    const principal = await authenticateAndAuthorise(req, deps, 'user.read', { agencyId: agency }, correlationId);
    return { status: 200, body: { data: await impact(agency, uid), meta: { correlationId, actor: principal.uid } } };
  }
  if (req.method === 'POST' && !uid) {
    const principal = await authenticateAndAuthorise(req, deps, 'user.invite', { agencyId: agency }, correlationId);
    const input = parseInvitePersonInput(await body(req), principal.role);
    const auth = getAuth(adminApp());
    let identity;
    try { identity = await auth.getUserByEmail(input.email); }
    catch { identity = await auth.createUser({ email: input.email, displayName: input.displayName, emailVerified: false }); }
    const membershipRef = getFirestore(adminApp()).doc(`agencies/${agency}/memberships/${identity.uid}`);
    if ((await membershipRef.get()).exists) throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'This person already has an agency membership.');
    const now = new Date(); const expiresAt = new Date(now.getTime() + (input.expiresInDays ?? 7) * 86400000).toISOString();
    const invitation: PeopleInvitation = { id: randomUUID(), agencyId: agency, email: input.email, displayName: input.displayName, role: input.role, status: 'pending', mfaRequired: input.mfaRequired === true, expiresAt, invitedBy: principal.uid, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await Promise.all([
      membershipRef.create({ uid: identity.uid, agencyId: agency, email: input.email, displayName: input.displayName ?? identity.displayName ?? '', role: input.role, status: 'invited', invitationExpiresAt: expiresAt, mfaRequired: invitation.mfaRequired, updatedAt: now.toISOString(), version: 1 }),
      getFirestore(adminApp()).doc(`agencies/${agency}/invitations/${invitation.id}`).create(invitation),
    ]);
    await appendAudit(deps, principal, 'user.invite', 'user_invited', identity.uid, correlationId, { invitationId: invitation.id, role: input.role });
    return { status: 201, body: { data: { userId: identity.uid, invitation } } };
  }
  if (!uid) return undefined;

  const membershipRef = getFirestore(adminApp()).doc(`agencies/${agency}/memberships/${uid}`);
  const snap = await membershipRef.get(); if (!snap.exists) throw new ApiError(404, 'MEMBERSHIP_NOT_FOUND', 'User membership was not found.');
  const membership = snap.data() as any;

  if (req.method === 'PATCH' && action === 'role') {
    const principal = await authenticateAndAuthorise(req, deps, 'user.role.manage', { agencyId: agency }, correlationId);
    if (principal.uid === uid) throw new ApiError(403, 'SELF_ROLE_CHANGE_FORBIDDEN', 'You cannot change your own role.');
    const input = parseChangeRoleInput(await body(req), principal.role);
    const before = membership.role;
    await membershipRef.update({ role: input.role, mfaRequired: membership.mfaRequired === true || ['super_admin','proinspect_admin','reviewer'].includes(input.role), updatedAt: new Date().toISOString(), version: (membership.version ?? 1) + 1 });
    await getAuth(adminApp()).revokeRefreshTokens(uid);
    await appendAudit(deps, principal, 'user.role.manage', 'user_role_changed', uid, correlationId, { before, after: input.role, reason: input.reason });
    return { status: 200, body: { data: { id: uid, role: input.role } } };
  }
  if (req.method === 'POST' && ['suspend','reactivate','revoke'].includes(action ?? '')) {
    const capability = action === 'suspend' ? 'user.suspend' : action === 'reactivate' ? 'user.reactivate' : 'user.revoke';
    const principal = await authenticateAndAuthorise(req, deps, capability as any, { agencyId: agency }, correlationId);
    if (principal.uid === uid && action !== 'reactivate') throw new ApiError(403, 'SELF_DEACTIVATION_FORBIDDEN', 'You cannot deactivate your own membership.');
    const input = parseMembershipActionInput(await body(req));
    if (['proinspect_admin','super_admin'].includes(String(membership.role)) && membership.status === 'active' && action !== 'reactivate' && await countActiveAdmins(agency) <= 1) throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'The final active administrator cannot be deactivated.');
    const newStatus = action === 'suspend' ? 'suspended' : action === 'reactivate' ? 'active' : 'revoked';
    const assignmentImpact = action === 'reactivate' ? undefined : await impact(agency, uid);
    await membershipRef.update({ status: newStatus, updatedAt: new Date().toISOString(), version: (membership.version ?? 1) + 1 });
    if (action !== 'reactivate') await getAuth(adminApp()).revokeRefreshTokens(uid);
    await appendAudit(deps, principal, capability, `user_${action}`, uid, correlationId, { reason: input.reason, ...(assignmentImpact ? { assignmentImpact } : {}) });
    return { status: 200, body: { data: { id: uid, status: newStatus, ...(assignmentImpact ? { assignmentImpact } : {}) } };
  }
  if (req.method === 'POST' && action === 'revoke-sessions') {
    const principal = await authenticateAndAuthorise(req, deps, 'user.session.revoke', { agencyId: agency }, correlationId);
    const input = parseMembershipActionInput(await body(req));
    await getAuth(adminApp()).revokeRefreshTokens(uid);
    await appendAudit(deps, principal, 'user.session.revoke', 'user_sessions_revoked', uid, correlationId, { reason: input.reason });
    return { status: 200, body: { data: { id: uid, sessionsRevoked: true } } };
  }
  if (req.method === 'PUT' && action === 'workforce') {
    const principal = await authenticateAndAuthorise(req, deps, 'workforce.manage', { agencyId: agency }, correlationId);
    const input = await body(req); const now = new Date().toISOString();
    const ref = getFirestore(adminApp()).doc(`agencies/${agency}/workforceProfiles/${uid}`); const existing = await ref.get();
    const record = { ...input, id: uid, agencyId: agency, userId: uid, active: input.active !== false, createdAt: existing.exists ? existing.data()?.createdAt ?? now : now, updatedAt: now, version: (existing.data()?.version ?? 0) + 1 };
    await ref.set(record, { merge: false });
    await appendAudit(deps, principal, 'workforce.manage', 'workforce_profile_updated', uid, correlationId);
    return { status: 200, body: { data: record } };
  }
  return undefined;
}
