import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppwriteIdentityVerifier } from '../src/security/appwriteIdentity.js';
import { FirebaseIdentityVerifier } from '../src/security/firebaseIdentity.js';
import { createSecurityDependencies } from '../src/security/defaultDependencies.js';
import {
  AppwriteIdempotencyStore,
  AppwriteReportAggregateStore,
  AppwriteTaskOutbox,
  AppwriteUploadSessionIssuer,
} from '../src/backend/appwriteAdapters.js';
import { SettingsAwareOperationalRepository } from '../src/services/settingsAwareOperationalRepository.js';
import { AppwritePeopleAdminService } from '../src/backend/appwritePeopleAdmin.js';

describe('API identity provider boundary', () => {
  it('preserves Firebase as the explicit migration fallback', () => {
    const dependencies = createSecurityDependencies({ AUTH_PROVIDER: 'firebase', NODE_ENV: 'test' });
    expect(dependencies.identityVerifier).toBeInstanceOf(FirebaseIdentityVerifier);
    expect(dependencies.requireAppCheck).toBe(false);
  });

  it('rejects Appwrite identity with a legacy or foundation operational backend', () => {
    expect(() => createSecurityDependencies({ AUTH_PROVIDER: 'appwrite', APPWRITE_BACKEND_MODE: 'disabled' })).toThrow(/requires APPWRITE_BACKEND_MODE=appwrite/u);
    expect(() => createSecurityDependencies({ AUTH_PROVIDER: 'appwrite', APPWRITE_BACKEND_MODE: 'foundation' })).toThrow(/requires APPWRITE_BACKEND_MODE=appwrite/u);
  });

  it('uses Appwrite JWT verification and disables Firebase App Check in Appwrite mode', () => {
    const dependencies = createSecurityDependencies({
      AUTH_PROVIDER: 'appwrite',
      APPWRITE_BACKEND_MODE: 'appwrite',
      APPWRITE_ENDPOINT: 'https://syd.cloud.appwrite.io/v1',
      APPWRITE_PROJECT_ID: 'proinspect-development',
      APPWRITE_API_KEY: randomUUID(),
      APPWRITE_DATABASE_ID: 'proinspect_core',
      REQUIRE_APP_CHECK: 'true',
    });
    expect(dependencies.identityVerifier).toBeInstanceOf(AppwriteIdentityVerifier);
    expect(dependencies.requireAppCheck).toBe(false);
    expect(dependencies.repository).toBeInstanceOf(SettingsAwareOperationalRepository);
    expect(dependencies.reports).toBeInstanceOf(AppwriteReportAggregateStore);
    expect(dependencies.idempotency).toBeInstanceOf(AppwriteIdempotencyStore);
    expect(dependencies.tasks).toBeInstanceOf(AppwriteTaskOutbox);
    expect(dependencies.uploads).toBeInstanceOf(AppwriteUploadSessionIssuer);
    expect(dependencies.peopleAdmin).toBeInstanceOf(AppwritePeopleAdminService);
    expect(JSON.stringify(dependencies)).not.toContain('Firestore');
    expect(JSON.stringify(dependencies)).not.toContain('Firebase');
  });

  it('rejects unknown identity providers', () => {
    expect(() => createSecurityDependencies({ AUTH_PROVIDER: 'custom' })).toThrow(/Unsupported AUTH_PROVIDER/u);
  });
});
