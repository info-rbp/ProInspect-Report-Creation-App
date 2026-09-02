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

  if (appwriteOperationalMode(env)) {
    const appwrite = createAppwriteApiServices(env);
    operationalRepository = new AppwriteOperationalRepository(appwrite);
    memberships = new AppwriteMembershipRepository(appwrite);
    audit = new AppwriteAuditWriter(appwrite);
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
    reports: new FirestoreReportAggregateStore(),
    idempotency: new FirestoreIdempotencyStore(),
    tasks: new FirestoreTaskOutbox(),
    uploads: new FirebaseUploadSessionIssuer(env.UPLOAD_BUCKET),
  };
}
