import { FirebaseIdentityVerifier } from './firebaseIdentity.js';
import { AppwriteIdentityVerifier } from './appwriteIdentity.js';
import { FirestoreMembershipRepository } from './membershipRepository.js';
import { FirestoreAuditWriter } from './auditWriter.js';
import { FirestoreOperationalRepository } from '../backend/firestoreRepository.js';
import { FirestoreReportAggregateStore } from '../backend/reportAggregateStore.js';
import { FirestoreIdempotencyStore } from '../backend/idempotency.js';
import { FirebaseUploadSessionIssuer, FirestoreTaskOutbox } from '../backend/integrations.js';
import {
  AppwriteAuditWriter,
  AppwriteIdempotencyStore,
  AppwriteMembershipRepository,
  AppwriteOperationalRepository,
  AppwriteReportAggregateStore,
  AppwriteTaskOutbox,
  AppwriteUploadSessionIssuer,
  createAppwriteApiServices,
} from '../backend/appwriteAdapters.js';
import { SettingsAwareOperationalRepository } from '../services/settingsAwareOperationalRepository.js';
import type {
  ApiDependencies,
  IdempotencyStore,
  OperationalRepository,
  ReportAggregateStore,
  TaskDispatcher,
  UploadSessionIssuer,
} from '../backend/types.js';

function appwriteOperationalMode(env: NodeJS.ProcessEnv): boolean {
  return ['foundation', 'appwrite'].includes(env.APPWRITE_BACKEND_MODE?.trim().toLowerCase() ?? '');
}

export function createSecurityDependencies(env: NodeJS.ProcessEnv = process.env): ApiDependencies {
  const authProvider = env.AUTH_PROVIDER?.trim().toLowerCase() || 'firebase';
  if (!['firebase', 'appwrite'].includes(authProvider)) {
    throw new Error(`Unsupported AUTH_PROVIDER '${authProvider}'. Use firebase or appwrite.`);
  }
  if (authProvider === 'appwrite' && env.APPWRITE_BACKEND_MODE?.trim().toLowerCase() !== 'appwrite') {
    throw new Error('AUTH_PROVIDER=appwrite requires APPWRITE_BACKEND_MODE=appwrite.');
  }

  let operationalRepository: OperationalRepository = new FirestoreOperationalRepository();
  let memberships = new FirestoreMembershipRepository();
  let audit = new FirestoreAuditWriter();
  let reports: ReportAggregateStore = new FirestoreReportAggregateStore();
  let idempotency: IdempotencyStore = new FirestoreIdempotencyStore();
  let tasks: TaskDispatcher = new FirestoreTaskOutbox();
  let uploads: UploadSessionIssuer = new FirebaseUploadSessionIssuer(env.UPLOAD_BUCKET);

  if (appwriteOperationalMode(env)) {
    const appwrite = createAppwriteApiServices(env);
    operationalRepository = new AppwriteOperationalRepository(appwrite);
    memberships = new AppwriteMembershipRepository(appwrite);
    audit = new AppwriteAuditWriter(appwrite);
    reports = new AppwriteReportAggregateStore(appwrite);
    idempotency = new AppwriteIdempotencyStore(appwrite);
    tasks = new AppwriteTaskOutbox(appwrite);
    uploads = new AppwriteUploadSessionIssuer(appwrite);
  }

  const repository = new SettingsAwareOperationalRepository(operationalRepository);
  return {
    identityVerifier: authProvider === 'appwrite'
      ? new AppwriteIdentityVerifier(env.APPWRITE_ENDPOINT, env.APPWRITE_PROJECT_ID)
      : new FirebaseIdentityVerifier(),
    memberships,
    audit,
    requireAppCheck: authProvider === 'firebase' && env.REQUIRE_APP_CHECK !== 'false' && env.NODE_ENV !== 'test',
    repository,
    reports,
    idempotency,
    tasks,
    uploads,
  };
}
