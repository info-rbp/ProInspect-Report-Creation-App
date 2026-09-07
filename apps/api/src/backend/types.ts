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


export type ExternalGrantResourceType =
  | 'work_request'
  | 'tenant_instruction'
  | 'client_approval'
  | 'report_distribution'
  | 'contractor_quote_request'
  | 'tenant_portal'
  | 'remote_inspection';

export interface ExternalGrantRecord {
  id: string;
  agencyId: string;
  resourceType: ExternalGrantResourceType;
  resourceId: string;
  tokenHash: string;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  recipientEmail?: string;
  tenantId?: string;
  tenancyId?: string;
  externalContactId?: string;
  purpose?: string;
  revokedAt?: string;
  revokedBy?: string;
  lastAccessedAt?: string;
  replacedByGrantId?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface ExternalGrantIssueInput {
  id: string;
  agencyId: string;
  resourceType: ExternalGrantResourceType;
  resourceId: string;
  tokenHash: string;
  expiresAt: string;
  actorId: string;
  recipientEmail?: string;
  tenantId?: string;
  tenancyId?: string;
  externalContactId?: string;
  purpose?: string;
}

export interface ExternalGrantStore {
  issue(
    input: ExternalGrantIssueInput,
  ): Promise<ExternalGrantRecord>;

  resolve(
    rawToken: string,
    allowedResourceTypes:
      readonly ExternalGrantResourceType[],
  ): Promise<ExternalGrantRecord>;

  get(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
    id: string,
  ): Promise<ExternalGrantRecord | undefined>;

  list(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
  ): Promise<ExternalGrantRecord[]>;

  revoke(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
    id: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<ExternalGrantRecord>;
}


export interface EvidenceUploadSessionRecord {
  id: string; agencyId: string; userId: string; bucketId: string; fileId: string;
  originalFilename: string; mimeType: string; size: number; checksum: string;
  expiresAt: string; status: string; propertyId?: string; managedSiteId?: string;
  inspectionJobId?: string; reportId?: string; entityType?: string; entityId?: string;
  completedAt?: string;
}
export interface EvidenceFileRecord {
  id: string; agencyId: string; bucketId: string; fileId: string; entityType: string;
  entityId: string; mimeType: string; originalFilename: string; size: number;
  checksum: string; uploadedBy: string; createdAt: string; updatedAt: string;
  generation: string; propertyId?: string; managedSiteId?: string;
}
export interface EvidenceStoreUploadInput {
  agencyId: string; uploadId: string; actorId: string; entityType: string;
  entityId: string; contentType?: string; bytes: Uint8Array;
}
export interface EvidenceStoreCompletionInput {
  agencyId: string; uploadId: string; actorId: string; entityType: string;
  entityId: string; source: string; category?: string;
}
export interface EvidenceStore {
  getSession(agencyId: string, uploadId: string): Promise<EvidenceUploadSessionRecord>;
  uploadBinary(input: EvidenceStoreUploadInput): Promise<EvidenceUploadSessionRecord>;
  complete(input: EvidenceStoreCompletionInput): Promise<EvidenceFileRecord>;
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
  externalGrants?: ExternalGrantStore;
  evidence?: EvidenceStore;
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
