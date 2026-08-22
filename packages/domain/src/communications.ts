export type CommunicationChannel = 'email' | 'sms' | 'portal' | 'phone' | 'system';
export type CommunicationEntityType = 'client' | 'property' | 'tenant' | 'tenancy' | 'inspection_job' | 'report' | 'maintenance_item' | 'maintenance_quote' | 'contractor' | 'document_packet';

export interface CommunicationEntityLink { entityType: CommunicationEntityType; entityId: string; }
export interface CommunicationParticipant { id: string; kind: 'internal_user' | 'client' | 'tenant' | 'contractor' | 'external'; displayName: string; email?: string; phone?: string; }

export interface CommunicationThread {
  id: string;
  agencyId: string;
  subject: string;
  status: 'open' | 'closed' | 'archived';
  participants: CommunicationParticipant[];
  entityLinks: CommunicationEntityLink[];
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CommunicationMessage {
  id: string;
  agencyId: string;
  threadId: string;
  channel: CommunicationChannel;
  direction: 'inbound' | 'outbound' | 'system';
  senderParticipantId?: string;
  recipientParticipantIds: string[];
  subject?: string;
  body: string;
  status: 'draft' | 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
  providerMessageId?: string;
  sentAt?: string;
  deliveredAt?: string;
  receivedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
