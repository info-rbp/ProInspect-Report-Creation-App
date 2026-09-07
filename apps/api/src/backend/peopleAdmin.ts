import type {
  DeactivationImpact,
  PeopleDirectoryEntry,
  PeopleInvitation,
  ReassignmentResult,
  SecurityRole,
  WorkforceProfile,
  WorkloadSummary,
} from '@pcr/domain';
import type { InvitePersonInput } from '@pcr/validation';

export type MembershipLifecycleAction = 'suspend' | 'reactivate' | 'revoke';

export interface PeopleRoleChangeResult {
  id: string;
  before: SecurityRole;
  after: SecurityRole;
}

export interface PeopleMembershipActionResult {
  id: string;
  status: 'active' | 'suspended' | 'revoked';
  assignmentImpact?: DeactivationImpact;
}

export interface PeopleInviteResult {
  userId: string;
  invitation: PeopleInvitation;
}

export interface PeopleAdminService {
  listDirectory(agencyId: string): Promise<PeopleDirectoryEntry[]>;
  workload(agencyId: string, userId: string): Promise<WorkloadSummary>;
  invite(agencyId: string, input: InvitePersonInput, actorId: string): Promise<PeopleInviteResult>;
  impact(agencyId: string, userId: string): Promise<DeactivationImpact>;
  changeRole(
    agencyId: string,
    userId: string,
    role: SecurityRole,
  ): Promise<PeopleRoleChangeResult>;
  changeMembershipStatus(
    agencyId: string,
    userId: string,
    action: MembershipLifecycleAction,
  ): Promise<PeopleMembershipActionResult>;
  reassign(
    agencyId: string,
    fromUserId: string,
    toUserId: string,
    actorId: string,
  ): Promise<ReassignmentResult>;
  revokeSessions(userId: string): Promise<void>;
  saveWorkforceProfile(
    agencyId: string,
    userId: string,
    input: Record<string, unknown>,
    actorId: string,
  ): Promise<WorkforceProfile>;
}
