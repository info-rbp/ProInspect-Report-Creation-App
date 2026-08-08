import type { AuthenticatedPrincipal, AuthorisationTarget, ReportAggregate, ReportLifecycleStatus, SecurityCapability } from '@pcr/domain';
import type { SecurityDependencies } from '../security/types.js';

export interface StoredRecord {
  id: string;
  agencyId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface OperationalRepository {
  list(collection: string, agencyId: string, limit: number, cursor?: string): Promise<Page<StoredRecord>>;
  get(collection: string, agencyId: string, id: string): Promise<StoredRecord | undefined>;
  create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string): Promise<StoredRecord>;
  update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string): Promise<StoredRecord>;
}

export interface ReportTransitionCommand {
  agencyId: string;
  reportId: string;
  status: ReportLifecycleStatus;
  expectedVersion: number;
  actorId: string;
  actorRole: string;
  correlationId: string;
  reason?: string;
  assignedUserId?: string;
}

export interface ReportAggregateStore {
  load(agencyId: string, reportId: string): Promise<ReportAggregate | undefined>;
  saveDraft(aggregate: ReportAggregate, expectedVersion: number | undefined, actorId: string): Promise<ReportAggregate>;
  transition(agencyId: string, command: ReportTransitionCommand): Promise<Record<string, unknown>>;
}

export interface IdempotencyResult {
  status: number;
  body: unknown;
}

export interface IdempotencyStore {
  execute(
    agencyId: string,
    operation: string,
    key: string,
    payloadHash: string,
    action: () => Promise<IdempotencyResult>,
  ): Promise<{ replayed: boolean; result: IdempotencyResult }>;
}

export interface TaskDispatcher {
  dispatch(kind: 'analysis' | 'pdf' | 'notification', agencyId: string, taskId: string, payload: Record<string, unknown>): Promise<void>;
}

export interface UploadSessionIssuer {
  create(agencyId: string, uploadId: string, input: Record<string, unknown>, principal: AuthenticatedPrincipal): Promise<Record<string, unknown>>;
}

export interface ApiDependencies extends SecurityDependencies {
  repository: OperationalRepository;
  reports: ReportAggregateStore;
  idempotency: IdempotencyStore;
  tasks: TaskDispatcher;
  uploads: UploadSessionIssuer;
}

export interface RoutePolicy {
  collection: string;
  readCapability: SecurityCapability;
  writeCapability?: SecurityCapability;
  target(body: Record<string, unknown>, id?: string): AuthorisationTarget;
}
