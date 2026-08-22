import { FirebaseIdentityVerifier } from './firebaseIdentity.js';
import { FirestoreMembershipRepository } from './membershipRepository.js';
import { FirestoreAuditWriter } from './auditWriter.js';
import { FirestoreOperationalRepository } from '../backend/firestoreRepository.js';
import { FirestoreReportAggregateStore } from '../backend/reportAggregateStore.js';
import { FirestoreIdempotencyStore } from '../backend/idempotency.js';
import { FirebaseUploadSessionIssuer, FirestoreTaskOutbox } from '../backend/integrations.js';
import { SettingsAwareOperationalRepository } from '../services/settingsAwareOperationalRepository.js';
import type { ApiDependencies } from '../backend/types.js';

export function createSecurityDependencies(env: NodeJS.ProcessEnv = process.env): ApiDependencies {
  const repository = new SettingsAwareOperationalRepository(new FirestoreOperationalRepository());
  return {
    identityVerifier: new FirebaseIdentityVerifier(),
    memberships: new FirestoreMembershipRepository(),
    audit: new FirestoreAuditWriter(),
    requireAppCheck: env.REQUIRE_APP_CHECK !== 'false' && env.NODE_ENV !== 'test',
    repository,
    reports: new FirestoreReportAggregateStore(),
    idempotency: new FirestoreIdempotencyStore(),
    tasks: new FirestoreTaskOutbox(),
    uploads: new FirebaseUploadSessionIssuer(env.UPLOAD_BUCKET),
  };
}
