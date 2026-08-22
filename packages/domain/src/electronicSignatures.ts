export type ESignEnvelopeStatus = 'draft' | 'sent' | 'delivered' | 'partially_signed' | 'completed' | 'declined' | 'voided' | 'expired';

export interface ESignRecipient {
  id: string;
  partyId?: string;
  name: string;
  email: string;
  role: string;
  order: number;
  required: boolean;
  authentication: 'email' | 'sms_otp' | 'portal' | 'provider';
  status: 'pending' | 'viewed' | 'signed' | 'declined';
  viewedAt?: string;
  signedAt?: string;
}

export interface ESignEnvelope {
  id: string;
  agencyId: string;
  provider: string;
  providerEnvelopeId?: string;
  documentId: string;
  documentVersion: number;
  documentSha256: string;
  status: ESignEnvelopeStatus;
  recipients: ESignRecipient[];
  consentRecordedAt?: string;
  completedDocumentObjectPath?: string;
  completedDocumentSha256?: string;
  certificateObjectPath?: string;
  certificateSha256?: string;
  sentAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
