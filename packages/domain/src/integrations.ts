export type IntegrationProviderKind = 'shopify' | 'google_calendar' | 'pms' | 'other';

export interface ExternalReference {
  id: string;
  agencyId: string;
  provider: string;
  entityType: 'client' | 'property' | 'tenant' | 'tenancy' | 'inspection_job' | 'report' | 'maintenance_item' | 'document_packet';
  entityId: string;
  externalId: string;
  externalUrl?: string;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PmsConnection {
  id: string;
  agencyId: string;
  provider: string;
  status: 'pending' | 'connected' | 'attention_required' | 'disconnected';
  credentialReference?: string;
  configuration: Record<string, string | number | boolean | string[] | undefined>;
  enabledDirections: Array<'import' | 'publish'>;
  lastSuccessfulSyncAt?: string;
  lastAttemptedSyncAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ExternalOperationalStatus {
  entityType: 'tenancy' | 'maintenance_item';
  entityId: string;
  sourceSystem: string;
  rentStatus?: 'current' | 'overdue' | 'unknown';
  bondStatus?: 'not_required' | 'pending' | 'lodged' | 'released' | 'unknown';
  invoiceStatus?: 'unknown' | 'not_issued' | 'issued' | 'paid_externally';
  retrievedAt: string;
}

export interface ConnectorSyncRun {
  id: string;
  agencyId: string;
  connectionId: string;
  direction: 'import' | 'publish';
  resource: string;
  status: 'queued' | 'running' | 'succeeded' | 'partially_succeeded' | 'failed';
  cursor?: string;
  processed: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
