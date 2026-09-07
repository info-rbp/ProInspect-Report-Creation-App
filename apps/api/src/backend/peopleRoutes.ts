import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  parseChangeRoleInput,
  parseInvitePersonInput,
  parseMembershipActionInput,
} from '@pcr/validation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { routeFirebasePeopleRequest } from './peopleLegacyAdapter.js';
import type { ApiDependencies } from './types.js';
import { ApiError, type ApiResponse } from './router.js';

function agencyId(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) {
    throw new ApiError(
      400,
      'AGENCY_HEADER_REQUIRED',
      'x-agency-id is required.',
    );
  }
  return value;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error();
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(
      400,
      'INVALID_JSON',
      'Request body must be a JSON object.',
    );
  }
}

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost')
    .pathname
    .split('/')
    .filter(Boolean);
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

export async function routePeopleRequest(
  req: IncomingMessage,
  deps: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (
    route[0] !== 'api'
    || route[1] !== 'v1'
    || route[2] !== 'people'
  ) {
    return undefined;
  }

  /*
   * Firebase remains an explicit migration fallback only.
   * Appwrite operational mode always supplies peopleAdmin.
   */
  const people = deps.peopleAdmin;
  if (!people) {
    return routeFirebasePeopleRequest(req, deps, correlationId);
  }

  const agency = agencyId(req);
  const uid = route[3];
  const action = route[4];

  if (req.method === 'GET' && !uid) {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'user.read',
      { agencyId: agency },
      correlationId,
    );
    return {
      status: 200,
      body: {
        data: await people.listDirectory(agency),
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (req.method === 'GET' && uid && action === 'impact') {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'user.read',
      { agencyId: agency },
      correlationId,
    );
    return {
      status: 200,
      body: {
        data: await people.impact(agency, uid),
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (req.method === 'GET' && uid && action === 'workload') {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'user.read',
      { agencyId: agency },
      correlationId,
    );
    return {
      status: 200,
      body: {
        data: await people.workload(agency, uid),
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (req.method === 'POST' && !uid) {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'user.invite',
      { agencyId: agency },
      correlationId,
    );
    const input = parseInvitePersonInput(await body(req), principal.role);
    const result = await people.invite(agency, input, principal.uid);

    await appendAudit(
      deps,
      principal,
      'user.invite',
      'user_invited',
      result.userId,
      correlationId,
      {
        invitationId: result.invitation.id,
        role: input.role,
      },
    );

    return {
      status: 201,
      body: {
        data: {
          userId: result.userId,
          invitation: result.invitation,
        },
      },
    };
  }

  if (!uid) return undefined;

  if (req.method === 'PATCH' && action === 'role') {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'user.role.manage',
      { agencyId: agency },
      correlationId,
    );

    if (principal.uid === uid) {
      throw new ApiError(
        403,
        'SELF_ROLE_CHANGE_FORBIDDEN',
        'You cannot change your own role.',
      );
    }

    const input = parseChangeRoleInput(await body(req), principal.role);
    const result = await people.changeRole(agency, uid, input.role);

    await appendAudit(
      deps,
      principal,
      'user.role.manage',
      'user_role_changed',
      uid,
      correlationId,
      {
        before: result.before,
        after: result.after,
        reason: input.reason,
      },
    );

    return {
      status: 200,
      body: { data: { id: uid, role: result.after } },
    };
  }

  if (
    req.method === 'POST'
    && ['suspend', 'reactivate', 'revoke'].includes(action ?? '')
  ) {
    const capability =
      action === 'suspend'
        ? 'user.suspend'
        : action === 'reactivate'
          ? 'user.reactivate'
          : 'user.revoke';

    const principal = await authenticateAndAuthorise(
      req,
      deps,
      capability as any,
      { agencyId: agency },
      correlationId,
    );

    if (principal.uid === uid && action !== 'reactivate') {
      throw new ApiError(
        403,
        'SELF_DEACTIVATION_FORBIDDEN',
        'You cannot deactivate your own membership.',
      );
    }

    const input = parseMembershipActionInput(await body(req));
    const result = await people.changeMembershipStatus(
      agency,
      uid,
      action as 'suspend' | 'reactivate' | 'revoke',
    );

    await appendAudit(
      deps,
      principal,
      capability,
      `user_${action}`,
      uid,
      correlationId,
      {
        reason: input.reason,
        ...(result.assignmentImpact
          ? { assignmentImpact: result.assignmentImpact }
          : {}),
      },
    );

    return {
      status: 200,
      body: {
        data: {
          id: uid,
          status: result.status,
          ...(result.assignmentImpact
            ? { assignmentImpact: result.assignmentImpact }
            : {}),
        },
      },
    };
  }

  if (req.method === 'POST' && action === 'reassign') {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'user.scope.manage',
      { agencyId: agency },
      correlationId,
    );

    const input = await body(req);
    const replacementUserId =
      typeof input.replacementUserId === 'string'
        ? input.replacementUserId.trim()
        : '';
    const reason =
      typeof input.reason === 'string'
        ? input.reason.trim()
        : '';

    if (!replacementUserId) {
      throw new ApiError(
        400,
        'REPLACEMENT_USER_REQUIRED',
        'replacementUserId is required.',
      );
    }

    if (reason.length < 5) {
      throw new ApiError(
        400,
        'REASON_REQUIRED',
        'A reason is required for reassignment.',
      );
    }

    const result = await people.reassign(
      agency,
      uid,
      replacementUserId,
      principal.uid,
    );

    await appendAudit(
      deps,
      principal,
      'user.scope.manage',
      'user_assignments_reassigned',
      uid,
      correlationId,
      { reason, ...result },
    );

    return { status: 200, body: { data: result } };
  }

  if (req.method === 'POST' && action === 'revoke-sessions') {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'user.session.revoke',
      { agencyId: agency },
      correlationId,
    );

    const input = parseMembershipActionInput(await body(req));
    await people.revokeSessions(uid);

    await appendAudit(
      deps,
      principal,
      'user.session.revoke',
      'user_sessions_revoked',
      uid,
      correlationId,
      { reason: input.reason },
    );

    return {
      status: 200,
      body: { data: { id: uid, sessionsRevoked: true } },
    };
  }

  if (req.method === 'PUT' && action === 'workforce') {
    const principal = await authenticateAndAuthorise(
      req,
      deps,
      'workforce.manage',
      { agencyId: agency },
      correlationId,
    );

    const record = await people.saveWorkforceProfile(
      agency,
      uid,
      await body(req),
      principal.uid,
    );

    await appendAudit(
      deps,
      principal,
      'workforce.manage',
      'workforce_profile_updated',
      uid,
      correlationId,
    );

    return { status: 200, body: { data: record } };
  }

  return undefined;
}
