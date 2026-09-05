import { createHash, randomUUID } from 'node:crypto';
import {
  Query,
  type AppwriteServerServices,
} from '@pcr/appwrite-server';
import {
  isPrivilegedPeopleRole,
  roleCapabilities,
  type DeactivationImpact,
  type IdentityProfile,
  type PeopleDirectoryEntry,
  type PeopleInvitation,
  type ReassignmentResult,
  type SecurityRole,
  type WorkforceProfile,
  type WorkloadSummary,
} from '@pcr/domain';
import type { InvitePersonInput } from '@pcr/validation';
import type {
  MembershipLifecycleAction,
  PeopleAdminService,
  PeopleInviteResult,
  PeopleMembershipActionResult,
  PeopleRoleChangeResult,
} from './peopleAdmin.js';

type Row = Record<string, unknown>;

const TERMINAL_STATUSES = new Set([
  'finalised',
  'archived',
  'cancelled',
  'closed',
  'completed',
]);

function fail(code: string, status: number, message: string): never {
  throw Object.assign(new Error(message), { code, status });
}

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const value = Number((error as { code?: unknown }).code);
  return Number.isFinite(value) ? value : undefined;
}

function deterministicId(...values: string[]): string {
  return createHash('sha256').update(values.join(':')).digest('hex').slice(0, 36);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function sameUtcDate(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

function activeAssignment(record: Row, userId: string): boolean {
  return [
    record.inspectorId,
    record.analystId,
    record.reviewerId,
    record.assignedUserId,
  ].some((value) => value === userId);
}

export class AppwritePeopleAdminService implements PeopleAdminService {
  constructor(private readonly services: AppwriteServerServices) {}

  private async listRows(tableId: string, queries: string[] = []): Promise<Row[]> {
    const rows: Row[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.services.tables.listRows({
        databaseId: this.services.databaseId,
        tableId,
        queries: [
          ...queries,
          Query.limit(100),
          ...(cursor ? [Query.cursorAfter(cursor)] : []),
        ],
      });

      const page = result.rows as unknown as Row[];
      rows.push(...page);

      if (page.length < 100) break;
      const next = text(page.at(-1)?.$id);
      if (!next || next === cursor) break;
      cursor = next;
    } while (cursor);

    return rows;
  }

  private async membershipRow(
    agencyId: string,
    userId: string,
  ): Promise<Row | undefined> {
    const result = await this.services.tables.listRows({
      databaseId: this.services.databaseId,
      tableId: 'agency_memberships',
      queries: [
        Query.equal('agencyId', [agencyId]),
        Query.equal('userId', [userId]),
        Query.limit(2),
      ],
    });
    return result.rows[0] as unknown as Row | undefined;
  }

  private async workforceRow(
    agencyId: string,
    userId: string,
  ): Promise<Row | undefined> {
    const result = await this.services.tables.listRows({
      databaseId: this.services.databaseId,
      tableId: 'workforce_profiles',
      queries: [
        Query.equal('agencyId', [agencyId]),
        Query.equal('userId', [userId]),
        Query.limit(2),
      ],
    });
    return result.rows[0] as unknown as Row | undefined;
  }

  private async userProfileRow(userId: string): Promise<Row | undefined> {
    const result = await this.services.tables.listRows({
      databaseId: this.services.databaseId,
      tableId: 'user_profiles',
      queries: [
        Query.equal('userId', [userId]),
        Query.limit(2),
      ],
    });
    return result.rows[0] as unknown as Row | undefined;
  }

  private workforceProfile(row: Row | undefined): WorkforceProfile | undefined {
    if (!row) return undefined;

    return {
      id: text(row.userId) || text(row.$id),
      agencyId: text(row.agencyId),
      userId: text(row.userId),
      active: row.active !== false,
      disciplines: stringArray(row.disciplines) as WorkforceProfile['disciplines'],
      inspectionTypes: stringArray(row.inspectionTypes) as WorkforceProfile['inspectionTypes'],
      propertyUses: stringArray(row.propertyUses) as WorkforceProfile['propertyUses'],
      serviceAreas: stringArray(row.serviceAreas),
      commercialQualified: row.commercialQualified === true,
      strataQualified: row.strataQualified === true,
      ...(numeric(row.maxJobsPerDay) !== undefined
        ? { maxJobsPerDay: numeric(row.maxJobsPerDay) }
        : {}),
      ...(numeric(row.maxActiveAnalyses) !== undefined
        ? { maxActiveAnalyses: numeric(row.maxActiveAnalyses) }
        : {}),
      ...(numeric(row.maxActiveReviews) !== undefined
        ? { maxActiveReviews: numeric(row.maxActiveReviews) }
        : {}),
      ...(text(row.defaultCalendarId)
        ? { defaultCalendarId: text(row.defaultCalendarId) }
        : {}),
      ...(objectValue(row.workingHours)
        ? {
            workingHours: objectValue(row.workingHours)
              as WorkforceProfile['workingHours'],
          }
        : {}),
      ...(stringArray(row.unavailableDates).length
        ? { unavailableDates: stringArray(row.unavailableDates) }
        : {}),
      createdAt: text(row.createdAt) || text(row.$createdAt),
      updatedAt: text(row.updatedAt) || text(row.$updatedAt),
      version: numeric(row.version) ?? 1,
    };
  }

  private async identity(userId: string): Promise<IdentityProfile | undefined> {
    try {
      const user = await this.services.users.get({ userId }) as unknown as Row;
      return {
        uid: text(user.$id) || userId,
        email: text(user.email),
        ...(text(user.name) ? { displayName: text(user.name) } : {}),
        ...(text(user.phone) ? { phone: text(user.phone) } : {}),
        emailVerified: user.emailVerification === true,
        disabled: user.status === false,
        ...(text(user.accessedAt) ? { lastSignInAt: text(user.accessedAt) } : {}),
        ...(text(user.$createdAt) || text(user.registration)
          ? { createdAt: text(user.$createdAt) || text(user.registration) }
          : {}),
      };
    } catch (error) {
      if (errorCode(error) === 404) return undefined;
      throw error;
    }
  }

  async listDirectory(agencyId: string): Promise<PeopleDirectoryEntry[]> {
    const [memberships, workforce] = await Promise.all([
      this.listRows('agency_memberships', [Query.equal('agencyId', [agencyId])]),
      this.listRows('workforce_profiles', [Query.equal('agencyId', [agencyId])]),
    ]);

    const workforceByUser = new Map(
      workforce.map((row) => [text(row.userId), this.workforceProfile(row)]),
    );

    return Promise.all(memberships.map(async (membership) => {
      const userId = text(membership.userId);
      const role = text(membership.role) as SecurityRole;
      const identity = await this.identity(userId);
      const profile = workforceByUser.get(userId);

      return {
        id: userId,
        agencyId,
        email: identity?.email ?? '',
        ...(identity?.displayName ? { displayName: identity.displayName } : {}),
        role,
        membershipStatus: text(membership.status) as PeopleDirectoryEntry['membershipStatus'],
        mfaRequired: membership.mfaRequired === true,
        effectiveCapabilities: [...roleCapabilities(role)],
        ...(identity ? { identity } : {}),
        ...(profile ? { workforceProfile: profile } : {}),
        workload: await this.workload(agencyId, userId),
        ...(text(membership.validUntil)
          ? { invitationExpiresAt: text(membership.validUntil) }
          : {}),
        updatedAt: text(membership.updatedAt) || text(membership.$updatedAt),
      };
    }));
  }

  async workload(agencyId: string, userId: string): Promise<WorkloadSummary> {
    const [jobs, reports, workforce] = await Promise.all([
      this.listRows('inspection_jobs', [Query.equal('agencyId', [agencyId])]),
      this.listRows('reports', [Query.equal('agencyId', [agencyId])]),
      this.workforceRow(agencyId, userId),
    ]);

    const now = new Date();
    const sevenDays = now.getTime() + 7 * 86_400_000;
    let inspectionsToday = 0;
    let inspectionsNext7Days = 0;
    let overdueAssignments = 0;

    for (const job of jobs) {
      if (TERMINAL_STATUSES.has(text(job.status))) continue;
      if (!activeAssignment(job, userId)) continue;

      const scheduledValue = text(job.scheduledDate) || text(job.scheduledAt);
      const scheduled = scheduledValue ? new Date(scheduledValue) : undefined;

      if (scheduled && Number.isFinite(scheduled.getTime())) {
        if (job.inspectorId === userId && sameUtcDate(scheduled, now)) {
          inspectionsToday += 1;
        }
        if (
          job.inspectorId === userId
          && scheduled.getTime() >= now.getTime()
          && scheduled.getTime() <= sevenDays
        ) {
          inspectionsNext7Days += 1;
        }
        if (
          scheduled.getTime() < now.getTime()
          && !['inspection_started', 'photos_uploading'].includes(text(job.status))
        ) {
          overdueAssignments += 1;
        }
      }
    }

    let activeAnalyses = 0;
    let activeReviews = 0;

    for (const report of reports) {
      if (TERMINAL_STATUSES.has(text(report.lifecycleStatus))) continue;
      if (report.analystId === userId) activeAnalyses += 1;
      if (report.reviewerId === userId) activeReviews += 1;
    }

    const profile = this.workforceProfile(workforce);
    return {
      inspectionsToday,
      inspectionsNext7Days,
      activeAnalyses,
      activeReviews,
      overdueAssignments,
      ...(typeof profile?.maxJobsPerDay === 'number'
        ? {
            capacityRemainingToday: Math.max(
              0,
              profile.maxJobsPerDay - inspectionsToday,
            ),
          }
        : {}),
    };
  }

  async invite(
    agencyId: string,
    input: InvitePersonInput,
    actorId: string,
  ): Promise<PeopleInviteResult> {
    const found = await this.services.users.list({
      queries: [
        Query.equal('email', [input.email]),
        Query.limit(2),
      ],
      total: false,
    });

    const users = found.users as unknown as Row[];
    let user = users[0];

    if (!user) {
      user = await this.services.users.create({
        userId: randomUUID(),
        email: input.email,
        ...(input.displayName
          ? { name: input.displayName.slice(0, 128) }
          : {}),
      }) as unknown as Row;
    }

    const userId = text(user.$id);
    if (!userId) fail('APPWRITE_USER_ID_MISSING', 500, 'Appwrite did not return a user ID.');

    if (await this.membershipRow(agencyId, userId)) {
      fail('MEMBERSHIP_EXISTS', 409, 'This person already has an agency membership.');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + (input.expiresInDays ?? 7) * 86_400_000,
    ).toISOString();

    const displayName =
      input.displayName?.trim()
      || text(user.name)
      || input.email.split('@')[0]
      || input.email;

    const existingProfile = await this.userProfileRow(userId);

    if (existingProfile) {
      await this.services.tables.updateRow({
        databaseId: this.services.databaseId,
        tableId: 'user_profiles',
        rowId: text(existingProfile.$id),
        data: {
          userId,
          displayName,
          email: input.email,
          status: 'active',
          updatedAt: nowIso,
        },
      });
    } else {
      await this.services.tables.createRow({
        databaseId: this.services.databaseId,
        tableId: 'user_profiles',
        rowId: userId,
        permissions: [],
        data: {
          userId,
          displayName,
          email: input.email,
          status: 'active',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      });
    }

    const membershipId = deterministicId('agency-membership', agencyId, userId);
    await this.services.tables.createRow({
      databaseId: this.services.databaseId,
      tableId: 'agency_memberships',
      rowId: membershipId,
      permissions: [],
      data: {
        userId,
        agencyId,
        role: input.role,
        status: 'invited',
        validFrom: nowIso,
        validUntil: expiresAt,
        mfaRequired: input.mfaRequired === true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });

    const invitationId = randomUUID();
    await this.services.tables.createRow({
      databaseId: this.services.databaseId,
      tableId: 'people_invitations',
      rowId: invitationId,
      permissions: [],
      data: {
        agencyId,
        userId,
        email: input.email,
        displayName,
        role: input.role,
        status: 'pending',
        mfaRequired: input.mfaRequired === true,
        expiresAt,
        invitedBy: actorId,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    const invitation: PeopleInvitation = {
      id: invitationId,
      agencyId,
      email: input.email,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      role: input.role,
      status: 'pending',
      mfaRequired: input.mfaRequired === true,
      expiresAt,
      invitedBy: actorId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return { userId, invitation };
  }

  async impact(agencyId: string, userId: string): Promise<DeactivationImpact> {
    const [jobs, reports, maintenance] = await Promise.all([
      this.listRows('inspection_jobs', [Query.equal('agencyId', [agencyId])]),
      this.listRows('reports', [Query.equal('agencyId', [agencyId])]),
      this.listRows('maintenance_items', [Query.equal('agencyId', [agencyId])]),
    ]);

    const activeInspectionJobIds = jobs
      .filter((row) => !TERMINAL_STATUSES.has(text(row.status)))
      .filter((row) => activeAssignment(row, userId))
      .map((row) => text(row.$id));

    const activeReportIds = reports
      .filter((row) => !TERMINAL_STATUSES.has(text(row.lifecycleStatus)))
      .filter((row) => activeAssignment(row, userId))
      .map((row) => text(row.$id));

    const activeMaintenanceItemIds = maintenance
      .filter((row) => !TERMINAL_STATUSES.has(text(row.status)))
      .filter((row) => row.assignedUserId === userId)
      .map((row) => text(row.$id));

    return {
      userId,
      activeInspectionJobIds,
      activeReportIds,
      activeMaintenanceItemIds,
      totalImpactedAssignments:
        activeInspectionJobIds.length
        + activeReportIds.length
        + activeMaintenanceItemIds.length,
    };
  }

  private async countActiveAdmins(agencyId: string): Promise<number> {
    const rows = await this.listRows(
      'agency_memberships',
      [Query.equal('agencyId', [agencyId]), Query.equal('status', ['active'])],
    );

    return rows.filter((row) =>
      ['proinspect_admin', 'super_admin'].includes(text(row.role)),
    ).length;
  }

  async changeRole(
    agencyId: string,
    userId: string,
    role: SecurityRole,
  ): Promise<PeopleRoleChangeResult> {
    const membership = await this.membershipRow(agencyId, userId);
    if (!membership) fail('MEMBERSHIP_NOT_FOUND', 404, 'User membership was not found.');

    const before = text(membership.role) as SecurityRole;
    await this.services.tables.updateRow({
      databaseId: this.services.databaseId,
      tableId: 'agency_memberships',
      rowId: text(membership.$id),
      data: {
        role,
        mfaRequired:
          membership.mfaRequired === true || isPrivilegedPeopleRole(role),
        updatedAt: new Date().toISOString(),
      },
    });

    await this.services.users.deleteSessions({ userId });
    return { id: userId, before, after: role };
  }

  async changeMembershipStatus(
    agencyId: string,
    userId: string,
    action: MembershipLifecycleAction,
  ): Promise<PeopleMembershipActionResult> {
    const membership = await this.membershipRow(agencyId, userId);
    if (!membership) fail('MEMBERSHIP_NOT_FOUND', 404, 'User membership was not found.');

    if (
      ['proinspect_admin', 'super_admin'].includes(text(membership.role))
      && text(membership.status) === 'active'
      && action !== 'reactivate'
      && await this.countActiveAdmins(agencyId) <= 1
    ) {
      fail(
        'LAST_ADMIN_REQUIRED',
        409,
        'The final active administrator cannot be deactivated.',
      );
    }

    const status =
      action === 'suspend'
        ? 'suspended'
        : action === 'reactivate'
          ? 'active'
          : 'revoked';

    const assignmentImpact =
      action === 'reactivate'
        ? undefined
        : await this.impact(agencyId, userId);

    await this.services.tables.updateRow({
      databaseId: this.services.databaseId,
      tableId: 'agency_memberships',
      rowId: text(membership.$id),
      data: {
        status,
        updatedAt: new Date().toISOString(),
      },
    });

    if (action !== 'reactivate') {
      await this.services.users.deleteSessions({ userId });
    }

    return {
      id: userId,
      status,
      ...(assignmentImpact ? { assignmentImpact } : {}),
    };
  }

  async reassign(
    agencyId: string,
    fromUserId: string,
    toUserId: string,
    actorId: string,
  ): Promise<ReassignmentResult> {
    if (fromUserId === toUserId) {
      fail(
        'REASSIGNMENT_TARGET_INVALID',
        400,
        'Choose a different replacement user.',
      );
    }

    const replacement = await this.membershipRow(agencyId, toUserId);
    if (!replacement || text(replacement.status) !== 'active') {
      fail(
        'REASSIGNMENT_TARGET_INACTIVE',
        409,
        'The replacement user must have an active agency membership.',
      );
    }

    const [jobs, reports, maintenance] = await Promise.all([
      this.listRows('inspection_jobs', [Query.equal('agencyId', [agencyId])]),
      this.listRows('reports', [Query.equal('agencyId', [agencyId])]),
      this.listRows('maintenance_items', [Query.equal('agencyId', [agencyId])]),
    ]);

    const updates: Array<{
      tableId: string;
      rowId: string;
      patch: Record<string, unknown>;
      kind: 'job' | 'report' | 'maintenance';
    }> = [];

    for (const row of jobs) {
      if (TERMINAL_STATUSES.has(text(row.status))) continue;
      const patch: Record<string, unknown> = {};
      if (row.inspectorId === fromUserId) patch.inspectorId = toUserId;
      if (row.analystId === fromUserId) patch.analystId = toUserId;
      if (row.reviewerId === fromUserId) patch.reviewerId = toUserId;
      if (Object.keys(patch).length) {
        updates.push({
          tableId: 'inspection_jobs',
          rowId: text(row.$id),
          patch,
          kind: 'job',
        });
      }
    }

    for (const row of reports) {
      if (TERMINAL_STATUSES.has(text(row.lifecycleStatus))) continue;
      const patch: Record<string, unknown> = {};
      if (row.inspectorId === fromUserId) patch.inspectorId = toUserId;
      if (row.analystId === fromUserId) patch.analystId = toUserId;
      if (row.reviewerId === fromUserId) patch.reviewerId = toUserId;
      if (Object.keys(patch).length) {
        updates.push({
          tableId: 'reports',
          rowId: text(row.$id),
          patch,
          kind: 'report',
        });
      }
    }

    for (const row of maintenance) {
      if (TERMINAL_STATUSES.has(text(row.status))) continue;
      if (row.assignedUserId === fromUserId) {
        updates.push({
          tableId: 'maintenance_items',
          rowId: text(row.$id),
          patch: { assignedUserId: toUserId },
          kind: 'maintenance',
        });
      }
    }

    if (updates.length > 400) {
      fail(
        'REASSIGNMENT_TOO_LARGE',
        409,
        'Reassignment affects too many records for one atomic operation.',
      );
    }

    if (updates.length) {
      const transaction = await this.services.tables.createTransaction({ ttl: 60 });
      const transactionId = transaction.$id;
      const now = new Date().toISOString();

      try {
        for (const update of updates) {
          await this.services.tables.updateRow({
            databaseId: this.services.databaseId,
            tableId: update.tableId,
            rowId: update.rowId,
            transactionId,
            data: {
              ...update.patch,
              updatedAt: now,
              updatedBy: actorId,
            },
          });
        }

        await this.services.tables.updateTransaction({
          transactionId,
          commit: true,
        });
      } catch (error) {
        await this.services.tables.updateTransaction({
          transactionId,
          rollback: true,
        }).catch(() => undefined);
        throw error;
      }
    }

    const inspectionJobsUpdated =
      updates.filter((item) => item.kind === 'job').length;
    const reportsUpdated =
      updates.filter((item) => item.kind === 'report').length;
    const maintenanceItemsUpdated =
      updates.filter((item) => item.kind === 'maintenance').length;

    return {
      fromUserId,
      toUserId,
      inspectionJobsUpdated,
      reportsUpdated,
      maintenanceItemsUpdated,
      totalUpdated: updates.length,
    };
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.services.users.deleteSessions({ userId });
  }

  async saveWorkforceProfile(
    agencyId: string,
    userId: string,
    input: Record<string, unknown>,
    actorId: string,
  ): Promise<WorkforceProfile> {
    const existing = await this.workforceRow(agencyId, userId);
    const now = new Date().toISOString();
    const version = (numeric(existing?.version) ?? 0) + 1;

    const disciplines =
      stringArray(input.disciplines) as WorkforceProfile['disciplines'];
    const inspectionTypes =
      stringArray(input.inspectionTypes) as WorkforceProfile['inspectionTypes'];
    const propertyUses =
      stringArray(input.propertyUses) as WorkforceProfile['propertyUses'];
    const serviceAreas = stringArray(input.serviceAreas);
    const unavailableDates = stringArray(input.unavailableDates);
    const workingHours =
      objectValue(input.workingHours) as WorkforceProfile['workingHours'];

    const profile: WorkforceProfile = {
      id: userId,
      agencyId,
      userId,
      active: input.active !== false,
      disciplines,
      inspectionTypes,
      propertyUses,
      serviceAreas,
      commercialQualified: input.commercialQualified === true,
      strataQualified: input.strataQualified === true,
      ...(numeric(input.maxJobsPerDay) !== undefined
        ? { maxJobsPerDay: numeric(input.maxJobsPerDay) }
        : {}),
      ...(numeric(input.maxActiveAnalyses) !== undefined
        ? { maxActiveAnalyses: numeric(input.maxActiveAnalyses) }
        : {}),
      ...(numeric(input.maxActiveReviews) !== undefined
        ? { maxActiveReviews: numeric(input.maxActiveReviews) }
        : {}),
      ...(text(input.defaultCalendarId)
        ? { defaultCalendarId: text(input.defaultCalendarId) }
        : {}),
      ...(workingHours ? { workingHours } : {}),
      ...(unavailableDates.length ? { unavailableDates } : {}),
      createdAt: text(existing?.createdAt) || now,
      updatedAt: now,
      version,
    };

    const rowData: Record<string, unknown> = {
      agencyId,
      userId,
      active: profile.active,
      disciplines: JSON.stringify(profile.disciplines),
      inspectionTypes: JSON.stringify(profile.inspectionTypes),
      propertyUses: JSON.stringify(profile.propertyUses),
      serviceAreas: JSON.stringify(profile.serviceAreas),
      commercialQualified: profile.commercialQualified,
      strataQualified: profile.strataQualified,
      unavailableDates: JSON.stringify(profile.unavailableDates ?? []),
      version,
      status: profile.active ? 'active' : 'inactive',
      createdAt: profile.createdAt,
      updatedAt: now,
      createdBy: text(existing?.createdBy) || actorId,
      updatedBy: actorId,
      ...(profile.maxJobsPerDay !== undefined
        ? { maxJobsPerDay: profile.maxJobsPerDay }
        : {}),
      ...(profile.maxActiveAnalyses !== undefined
        ? { maxActiveAnalyses: profile.maxActiveAnalyses }
        : {}),
      ...(profile.maxActiveReviews !== undefined
        ? { maxActiveReviews: profile.maxActiveReviews }
        : {}),
      ...(profile.defaultCalendarId
        ? { defaultCalendarId: profile.defaultCalendarId }
        : {}),
      ...(profile.workingHours
        ? { workingHours: JSON.stringify(profile.workingHours) }
        : {}),
    };

    if (existing) {
      await this.services.tables.updateRow({
        databaseId: this.services.databaseId,
        tableId: 'workforce_profiles',
        rowId: text(existing.$id),
        data: rowData,
      });
    } else {
      await this.services.tables.createRow({
        databaseId: this.services.databaseId,
        tableId: 'workforce_profiles',
        rowId: deterministicId('workforce-profile', agencyId, userId),
        permissions: [],
        data: rowData,
      });
    }

    return profile;
  }
}
