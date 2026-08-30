import { FirebaseIdentityVerifier } from './firebaseIdentity.js';
import { FirestoreMembershipRepository } from './membershipRepository.js';
import { FirestoreAuditWriter } from './auditWriter.js';
import { FirestoreOperationalRepository } from '../backend/firestoreRepository.js';
import { FirestoreReportAggregateStore } from '../backend/reportAggregateStore.js';
import { FirestoreIdempotencyStore } from '../backend/idempotency.js';
import { FirebaseUploadSessionIssuer, FirestoreTaskOutbox } from '../backend/integrations.js';
import {
  AppwriteAuditWriter,
  AppwriteMembershipRepository,
  AppwriteOperationalRepository,
  createAppwriteApiServices,
} from '../backend/appwriteAdapters.js';
import { SettingsAwareOperationalRepository } from '../services/settingsAwareOperationalRepository.js';
import type { ApiDependencies, OperationalRepository } from '../backend/types.js';

function appwriteOperationalMode(env: NodeJS.ProcessEnv): boolean {
  return ['foundation', 'appwrite'].includes(env.APPWRITE_BACKEND_MODE?.trim().toLowerCase() ?? '');
}

export function createSecurityDependencies(env: NodeJS.ProcessEnv = process.env): ApiDependencies {
  let operationalRepository: OperationalRepository = new FirestoreOperationalRepository();
  let memberships = new FirestoreMembershipRepository();
  let audit = new FirestoreAuditWriter();

  if (appwriteOperationalMode(env)) {
    const appwrite = createAppwriteApiServices(env);
    operationalRepository = new AppwriteOperationalRepository(appwrite);
    memberships = new AppwriteMembershipRepository(appwrite);
    audit = new AppwriteAuditWriter(appwrite);
  }

  const repository = new SettingsAwareOperationalRepository(operationalRepository);
  return {
    identityVerifier: new FirebaseIdentityVerifier(),
    memberships,
    audit,
    requireAppCheck: env.REQUIRE_APP_CHECK !== 'false' && env.NODE_ENV !== 'test',
    repository,
    reports: new FirestoreReportAggregateStore(),
    idempotency: new FirestoreIdempotencyStore(),
    tasks: new FirestoreTaskOutbox(),
    uploads: new FirebaseUploadSessionIssuer(env.UPLOAD_BUCKET),
  };
}
