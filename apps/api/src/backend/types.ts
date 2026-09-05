import type {
  AuthenticatedPrincipal,
  AuthorisationTarget,
  ReportAggregate,
  ReportLifecycleStatus,
  SecurityCapability,
} from '@pcr/domain';
import type { SecurityDependencies } from '../security/types.js';
import type { PeopleAdminService } from './peopleAdmin.js';

export interface StoredRecord {
  id: string;
  agencyId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  propertySnapshot?: { address?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface OperationalRepository {
  list(
    collection: string,
    agencyId: string,
    limit: number,
    cursor?: string,
    filters?: Record<string, string | number | boolean>,
  ): Promise<Page<StoredRecord>>;
  get(
    collection: string,
    agencyId: string,
    id: string,
  ): Promise<StoredRecord | undefined>;
  create(
    collection: string,
    agencyId: string,
    id: string,
    data: Record<string, unknown>,
    actorId: string,
  ): Promise<StoredRecord>;
  update(
    collection: string,
    agencyId: string,
    id: string,
    data: Record<string, unknown>,
    expectedVersion: number,
    actorId: string,
  ): Promise<StoredRecord>;
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
  load(
    agencyId: string,
    reportId: string,
  ): Promise<ReportAggregate | undefined>;
  saveDraft(
    aggregate: ReportAggregate,
    expectedVersion: number | undefined,
    actorId: string,
  ): Promise<ReportAggregate>;
  transition(
    agencyId: string,
    command: ReportTransitionCommand,
  ): Promise<Record<string, unknown>>;
}

export interface ReportVersionSnapshot {
  id: string;
  agencyId: string;
  reportId: string;
  version: number;
  immutable: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  aggregate: ReportAggregate;
  contentHash?: string;
  createdBy?: string;
  updatedBy?: string;
  finalisedAt?: string;
  supersedesVersionId?: string;
}

export interface ReportVersionReader {
  get(
    agencyId: string,
    reportId: string,
    versionId: string,
  ): Promise<ReportVersionSnapshot | undefined>;
  list(
    agencyId: string,
    reportId: string,
  ): Promise<ReportVersionSnapshot[]>;
}

export type NotificationDeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed';

export interface NotificationDeliveryUpdate {
  agencyId: string;
  notificationId: string;
  communicationId?: string;
  status: NotificationDeliveryStatus;
  metadata?: Record<string, unknown>;
}

export interface NotificationDeliveryStore {
  update(input: NotificationDeliveryUpdate): Promise<void>;
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

export type TaskKind =
  | 'analysis'
  | 'pdf'
  | 'notification'
  | 'document'
  | 'integration';

export interface TaskDispatcher {
  dispatch(
    kind: TaskKind,
    agencyId: string,
    taskId: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

export interface UploadSessionIssuer {
  create(
    agencyId: string,
    uploadId: string,
    input: Record<string, unknown>,
    principal: AuthenticatedPrincipal,
  ): Promise<Record<string, unknown>>;
}

export interface ApiDependencies extends SecurityDependencies {
  repository: OperationalRepository;
  reports: ReportAggregateStore;
  reportVersions?: ReportVersionReader;
  notificationDelivery?: NotificationDeliveryStore;
  idempotency: IdempotencyStore;
  tasks: TaskDispatcher;
  uploads: UploadSessionIssuer;
  peopleAdmin?: PeopleAdminService;
}

export interface RoutePolicy {
  collection: string;
  readCapability: SecurityCapability;
  writeCapability?: SecurityCapability;
  target(
    body: Record<string, unknown>,
    id?: string,
  ): AuthorisationTarget;
}
