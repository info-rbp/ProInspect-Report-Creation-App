import type { ApiDependencies, StoredRecord } from '../backend/types.js';
import { decryptIntegrationSecret, encryptIntegrationSecret, type EncryptedSecret } from './integrationSecurityService.js';

export type IntegrationCredentialProvider = 'shopify' | 'google_calendar' | 'xero' | 'sendgrid' | 'twilio';

interface CredentialRecord extends StoredRecord {
  provider: IntegrationCredentialProvider;
  encryptedSecret: EncryptedSecret;
}

function additionalData(agencyId: string, connectionId: string): string { return `${agencyId}:${connectionId}`; }

export async function saveIntegrationCredentials<T>(dependencies: ApiDependencies, input: { agencyId: string; connectionId: string; provider: IntegrationCredentialProvider; credentials: T; actorId: string }): Promise<void> {
  const encryptedSecret = encryptIntegrationSecret(input.credentials, additionalData(input.agencyId, input.connectionId));
  const existing = await dependencies.repository.get('integrationCredentials', input.agencyId, input.connectionId);
  const data = { provider: input.provider, encryptedSecret };
  if (existing) await dependencies.repository.update('integrationCredentials', input.agencyId, input.connectionId, data, Number(existing.version), input.actorId);
  else await dependencies.repository.create('integrationCredentials', input.agencyId, input.connectionId, data, input.actorId);
}

export async function loadIntegrationCredentials<T>(dependencies: ApiDependencies, agencyId: string, connectionId: string): Promise<T | undefined> {
  const record = await dependencies.repository.get('integrationCredentials', agencyId, connectionId);
  if (!record) return undefined;
  const credential = record as CredentialRecord;
  return decryptIntegrationSecret<T>(credential.encryptedSecret, additionalData(agencyId, connectionId));
}
