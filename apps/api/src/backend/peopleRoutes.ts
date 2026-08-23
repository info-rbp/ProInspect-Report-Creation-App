import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  roleCapabilities,
  type PeopleDirectoryEntry,
  type PeopleInvitation,
  type ReassignmentResult,
  type WorkforceProfile,
  type WorkloadSummary,
} from '@pcr/domain';
import { parseChangeRoleInput, parseInvitePersonInput, parseMembershipActionInput } from '@pcr/validation';
import { firestoreDb } from '../firestoreDatabase.js';
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
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
}
function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}
async function appendAudit(
  deps: ApiDependencies,
  principal: { uid: string; role: string; agencyId: string },
  capability: any,
  eventType: string,
  entityId: string,
  correlationId: string,
  metadata?: Record<string, unknown>,
) {
  await deps.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId: principal.agencyId,
    capability,
    outcome: 'allowed',
    reason: `material_action:${eventType}`,
    target: { agencyId: principal.agencyId },
    correlationId,
    eventType,
    entityType: 'user',
    entityId,
    ...(metadata ? { metadata } : {}),
  });
}
function isTerminalStatus(value: unknown): boolean {
  return ['finalised', 'archived', 'cancelled', 'closed', 'completed'].includes(String(value));
}
function sameUtcDate(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}
async function workload(agency: string, uid: string, maxJobsPerDay?: number): Promise<WorkloadSummary> {
  const db = firestoreDb(adminApp());
  const [jobs, reports] = await Promise.all([
    db.collection(`agencies/${agency}/inspectionJobs`).get(),
    db.collection(`agencies/${agency}/reports`).get(),
  ]);
  const now = new Date();
  const sevenDays = now.getTime() + 7 * 86_400_000;
  let inspectionsToday = 0;
  let inspectionsNext7Days = 0;
  let overdueAssignments = 0;
  for (const document of jobs.docs) {
    const job = document.data();
    if (isTerminalStatus(job.status) || ![job.assignedInspectorId, job.assignedAnalystId, job.assignedReviewerId].includes(uid)) continue;
    const scheduled = typeof job.scheduledAt === 'string' ? new Date(job.scheduledAt) : undefined;
    if (scheduled && Number.isFinite(scheduled.getTime())) {
      if (job.assignedInspectorId === uid && sameUtcDate(scheduled, now)) inspectionsToday += 1;
      if (job.assignedInspectorId === uid && scheduled.getTime() >= now.getTime() && scheduled.getTime() <= sevenDays) inspectionsNext7Days += 1;
      if (scheduled.getTime() < now.getTime() && !['inspection_started', 'photos_uploading'].includes(String(job.status))) overdueAssignments += 1;
    }
  }
  let activeAnalyses = 0;
  let activeReviews = 0;
  for (const document of reports.docs) {
    const report = document.data();
    if (isTerminalStatus(report.lifecycleStatus)) continue;
    if (report.assignedAnalystId === uid) activeAnalyses += 1;
    if (report.assignedReviewerId === uid) activeReviews += 1;
  }
  return {
    inspectionsToday,
    inspectionsNext7Days,
    activeAnalyses,
    activeReviews,
    overdueAssignments,
    ...(typeof maxJobsPerDay === 'number' ? { capacityRemainingToday: Math.max(0, maxJobsPerDay - inspectionsToday) } : {}),
  };
}
async function listDirectory(agency: string): Promise<PeopleDirectoryEntry[]> {
  const db = firestoreDb(adminApp());
  const [membershipSnapshot, workforceSnapshot] = await Promise.all([
    db.collection(`agencies/${agency}/memberships`).get(),
    db.collection(`agencies/${agency}/workforceProfiles`).get(),
  ]);
  const workforce = new Map(workforceSnapshot.docs.map((document) => [
    String(document.data().userId),
    { id: document.id, ...document.data() } as WorkforceProfile,
  ]));
  const auth = getAuth(adminApp());
  return Promise.all(membershipSnapshot.docs.map(async (document) => {
    const membership = document.data() as any;
    let identity: any;
    try {
      const user = await auth.getUser(document.id);
      identity = {
        uid: user.uid,
        email: user.email ?? membership.email ?? '',
        displayName: user.displayName,
        phone: user.phoneNumber,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        lastSignInAt: user.metadata.lastSignInTime,
        createdAt: user.metadata.creationTime,
      };
    } catch {
      identity = undefined;
    }
    const profile = workforce.get(document.id);
    return {
      id: document.id,
      agencyId: agency,
      email: identity?.email ?? membership.email ?? '',
      displayName: membership.displayName ?? identity?.displayName,
      role: membership.role,
      membershipStatus: membership.status,
      mfaRequired: membership.mfaRequired === true,
      effectiveCapabilities: [...roleCapabilities(membership.role)],
      ...(identity ? { identity } : {}),
      ...(profile ? { workforceProfile: profile } : {}),
      workload: await workload(agency, document.id, profile?.maxJobsPerDay),
      ...(membership.invitationExpiresAt ? { invitationExpiresAt: membership.invitationExpiresAt } : {}),
      updatedAt: membership.updatedAt ?? new Date(0).toISOString(),
      version: membership.version ?? 1,
    } as PeopleDirectoryEntry;
  }));
}
async function countActiveAdmins(agency: string): Promise<number> {
  const snapshot = await firestoreDb(adminApp()).collection(`agencies/${agency}/memberships`).where('status', '==', 'active').get();
  return snapshot.docs.filter((document) => ['proinspect_admin', 'super_admin'].includes(String(document.data().role))).length;
}
async function impact(agency: string, uid: string) {
  const db = firestoreDb(adminApp());
  const [jobs, reports, maintenance] = await Promise.all([
    db.collection(`agencies/${agency}/inspectionJobs`).get(),
    db.collection(`agencies/${agency}/reports`).get(),
    db.collection(`agencies/${agency}/maintenanceItems`).get(),
  ]);
  const activeJobIds = jobs.docs.filter((document) => {
    const value = document.data();
    return !isTerminalStatus(value.status) && [value.assignedInspectorId, value.assignedAnalystId, value.assignedReviewerId].includes(uid);
  }).map((document) => document.id);
  const activeReportIds = reports.docs.filter((document) => {
    const value = document.data();
    return !isTerminalStatus(value.lifecycleStatus) && [value.assignedInspectorId, value.assignedAnalystId, value.assignedReviewerId].includes(uid);
  }).map((document) => document.id);
  const activeMaintenanceItemIds = maintenance.docs.filter((document) => {
    const value = document.data();
    return !isTerminalStatus(value.status) && [value.assignedUserId, value.assignedTo].includes(uid);
  }).map((document) => document.id);
  return {
    userId: uid,
    activeInspectionJobIds: activeJobIds,
    activeReportIds: activeReportIds,
    activeMaintenanceItemIds,
    totalImpactedAssignments: activeJobIds.length + activeReportIds.length + activeMaintenanceItemIds.length,
  };
}
async function reassign(agency: string, fromUid: string, toUid: string): Promise<ReassignmentResult> {
  if (fromUid === toUid) throw new ApiError(400, 'REASSIGNMENT_TARGET_INVALID', 'Choose a different replacement user.');
  const db = firestoreDb(adminApp());
  const replacement = await db.doc(`agencies/${agency}/memberships/${toUid}`).get();
  if (!replacement.exists || replacement.data()?.status !== 'active') {
    throw new ApiError(409, 'REASSIGNMENT_TARGET_INACTIVE', 'The replacement user must have an active agency membership.');
  }
  const [jobs, reports, maintenance] = await Promise.all([
    db.collection(`agencies/${agency}/inspectionJobs`).get(),
    db.collection(`agencies/${agency}/reports`).get(),
    db.collection(`agencies/${agency}/maintenanceItems`).get(),
  ]);
  const updates: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown>; kind: 'job' | 'report' | 'maintenance' }> = [];
  for (const document of jobs.docs) {
    const value = document.data();
    if (isTerminalStatus(value.status)) continue;
    const patch: Record<string, unknown> = {};
    if (value.assignedInspectorId === fromUid) patch.assignedInspectorId = toUid;
    if (value.assignedAnalystId === fromUid) patch.assignedAnalystId = toUid;
    if (value.assignedReviewerId === fromUid) patch.assignedReviewerId = toUid;
    if (Object.keys(patch).length) updates.push({ ref: document.ref, patch, kind: 'job' });
  }
  for (const document of reports.docs) {
    const value = document.data();
    if (isTerminalStatus(value.lifecycleStatus)) continue;
    const patch: Record<string, unknown> = {};
    if (value.assignedInspectorId === fromUid) patch.assignedInspectorId = toUid;
    if (value.assignedAnalystId === fromUid) patch.assignedAnalystId = toUid;
    if (value.assignedReviewerId === fromUid) patch.assignedReviewerId = toUid;
    if (Object.keys(patch).length) updates.push({ ref: document.ref, patch, kind: 'report' });
  }
  for (const document of maintenance.docs) {
    const value = document.data();
    if (isTerminalStatus(value.status)) continue;
    const patch: Record<string, unknown> = {};
    if (value.assignedUserId === fromUid) patch.assignedUserId = toUid;
    if (value.assignedTo === fromUid) patch.assignedTo = toUid;
    if (Object.keys(patch).length) updates.push({ ref: document.ref, patch, kind: 'maintenance' });
  }
  if (updates.length > 400) throw new ApiError(409, 'REASSIGNMENT_TOO_LARGE', 'Reassignment affects too many records for one atomic operation.');
  const batch = db.batch();
  const now = new Date().toISOString();
  for (const update of updates) batch.update(update.ref, { ...update.patch, updatedAt: now });
  await batch.commit();
  const inspectionJobsUpdated = updates.filter((item) => item.kind === 'job').length;
  const reportsUpdated = updates.filter((item) => item.kind === 'report').length;
  const maintenanceItemsUpdated = updates.filter((item) => item.kind === 'maintenance').length;
  return {
    fromUserId: fromUid,
    toUserId: toUid,
    inspectionJobsUpdated,
    reportsUpdated,
    maintenanceItemsUpdated,
    totalUpdated: updates.length,
  };
}

export async function routePeopleRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'people') return undefined;
  const agency = agencyId(req);
  const uid = route[3];
  const action = route[4];

  if (req.method === 'GET' && !uid) {
    const principal = await authenticateAndAuthorise(req, deps, 'user.read', { agencyId: agency }, correlationId);
    return { status: 200, body: { data: await listDirectory(agency), meta: { correlationId, actor: principal.uid } } };
  }
  if (req.method === 'GET' && uid && action === 'impact') {
    const principal = await authenticateAndAuthorise(req, deps, 'user.read', { agencyId: agency }, correlationId);
    return { status: 200, body: { data: await impact(agency, uid), meta: { correlationId, actor: principal.uid } } };
  }
  if (req.method === 'GET' && uid && action === 'workload') {
    const principal = await authenticateAndAuthorise(req, deps, 'user.read', { agencyId: agency }, correlationId);
    const profile = await firestoreDb(adminApp()).doc(`agencies/${agency}/workforceProfiles/${uid}`).get();
    return { status: 200, body: { data: await workload(agency, uid, profile.data()?.maxJobsPerDay), meta: { correlationId, actor: principal.uid } } };
  }
  if (req.method === 'POST' && !uid) {
    const principal = await authenticateAndAuthorise(req, deps, 'user.invite', { agencyId: agency }, correlationId);
    const input = parseInvitePersonInput(await body(req), principal.role);
    const auth = getAuth(adminApp());
    let identity;
    try { identity = await auth.getUserByEmail(input.email); }
    catch { identity = await auth.createUser({ email: input.email, displayName: input.displayName, emailVerified: false }); }
    const membershipRef = firestoreDb(adminApp()).doc(`agencies/${agency}/memberships/${identity.uid}`);
    if ((await membershipRef.get()).exists) throw new ApiError(409, 'MEMBERSHIP_EXISTS', 'This person already has an agency membership.');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.expiresInDays ?? 7) * 86_400_000).toISOString();
    const invitation: PeopleInvitation = {
      id: randomUUID(), agencyId: agency, email: input.email, displayName: input.displayName,
      role: input.role, status: 'pending', mfaRequired: input.mfaRequired === true, expiresAt,
      invitedBy: principal.uid, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    await Promise.all([
      membershipRef.create({ uid: identity.uid, agencyId: agency, email: input.email, displayName: input.displayName ?? identity.displayName ?? '', role: input.role, status: 'invited', invitationExpiresAt: expiresAt, mfaRequired: invitation.mfaRequired, updatedAt: now.toISOString(), version: 1 }),
      firestoreDb(adminApp()).doc(`agencies/${agency}/invitations/${invitation.id}`).create(invitation),
    ]);
    await appendAudit(deps, principal, 'user.invite', 'user_invited', identity.uid, correlationId, { invitationId: invitation.id, role: input.role });
    return { status: 201, body: { data: { userId: identity.uid, invitation } } };
  }
  if (!uid) return undefined;

  const membershipRef = firestoreDb(adminApp()).doc(`agencies/${agency}/memberships/${uid}`);
  const snapshot = await membershipRef.get();
  if (!snapshot.exists) throw new ApiError(404, 'MEMBERSHIP_NOT_FOUND', 'User membership was not found.');
  const membership = snapshot.data() as any;

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
  if (req.method === 'POST' && ['suspend', 'reactivate', 'revoke'].includes(action ?? '')) {
    const capability = action === 'suspend' ? 'user.suspend' : action === 'reactivate' ? 'user.reactivate' : 'user.revoke';
    const principal = await authenticateAndAuthorise(req, deps, capability as any, { agencyId: agency }, correlationId);
    if (principal.uid === uid && action !== 'reactivate') throw new ApiError(403, 'SELF_DEACTIVATION_FORBIDDEN', 'You cannot deactivate your own membership.');
    const input = parseMembershipActionInput(await body(req));
    if (['proinspect_admin','super_admin'].includes(String(membership.role)) && membership.status === 'active' && action !== 'reactivate' && await countActiveAdmins(agency) <= 1) {
      throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'The final active administrator cannot be deactivated.');
    }
    const newStatus = action === 'suspend' ? 'suspended' : action === 'reactivate' ? 'active' : 'revoked';
    const assignmentImpact = action === 'reactivate' ? undefined : await impact(agency, uid);
    await membershipRef.update({ status: newStatus, updatedAt: new Date().toISOString(), version: (membership.version ?? 1) + 1 });
    if (action !== 'reactivate') await getAuth(adminApp()).revokeRefreshTokens(uid);
    await appendAudit(deps, principal, capability, `user_${action}`, uid, correlationId, { reason: input.reason, ...(assignmentImpact ? { assignmentImpact } : {}) });
    return { status: 200, body: { data: { id: uid, status: newStatus, ...(assignmentImpact ? { assignmentImpact } : {}) } };
  }
  if (req.method === 'POST' && action === 'reassign') {
    const principal = await authenticateAndAuthorise(req, deps, 'user.scope.manage', { agencyId: agency }, correlationId);
    const input = await body(req);
    const replacementUserId = typeof input.replacementUserId === 'string' ? input.replacementUserId.trim() : '';
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!replacementUserId) throw new ApiError(400, 'REPLACEMENT_USER_REQUIRED', 'replacementUserId is required.');
    if (reason.length < 5) throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required for reassignment.');
    const result = await reassign(agency, uid, replacementUserId);
    await appendAudit(deps, principal, 'user.scope.manage', 'user_assignments_reassigned', uid, correlationId, { reason, ...result });
    return { status: 200, body: { data: result } };
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
    const input = await body(req);
    const now = new Date().toISOString();
    const reference = firestoreDb(adminApp()).doc(`agencies/${agency}/workforceProfiles/${uid}`);
    const existing = await reference.get();
    const record = {
      ...input, id: uid, agencyId: agency, userId: uid, active: input.active !== false,
      createdAt: existing.exists ? existing.data()?.createdAt ?? now : now,
      updatedAt: now, version: (existing.data()?.version ?? 0) + 1,
    };
    await reference.set(record, { merge: false });
    await appendAudit(deps, principal, 'workforce.manage', 'workforce_profile_updated', uid, correlationId);
    return { status: 200, body: { data: record } };
  }
  return undefined;
}
