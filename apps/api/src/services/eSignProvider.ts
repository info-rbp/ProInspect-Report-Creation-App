import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CreateEnvelopeInput {
  externalReference: string;
  documentUrl: string;
  documentSha256: string;
  title: string;
  recipients: Array<{ id: string; name: string; email: string; role: string; order: number; authentication: string }>;
  callbackUrl?: string;
}

export interface ProviderEnvelope {
  id: string;
  status: string;
  recipients?: Array<{ id?: string; email?: string; status?: string; viewedAt?: string; signedAt?: string }>;
  completedDocumentUrl?: string;
  certificateUrl?: string;
}

export class ConfiguredESignProvider {
  constructor(
    private readonly baseUrl = process.env.ESIGN_API_BASE_URL?.trim().replace(/\/$/u, ''),
    private readonly token = process.env.ESIGN_API_TOKEN?.trim(),
    private readonly webhookSecret = process.env.ESIGN_WEBHOOK_SECRET?.trim(),
  ) {}

  private assertConfigured() {
    if (!this.baseUrl || !/^https:\/\//u.test(this.baseUrl)) throw new Error('ESIGN_API_BASE_URL must be configured with an HTTPS provider/gateway endpoint.');
    if (!this.token) throw new Error('ESIGN_API_TOKEN is required.');
  }

  private async request(path: string, init: RequestInit = {}): Promise<ProviderEnvelope> {
    this.assertConfigured();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`E-sign provider request failed with ${response.status}.`);
    const payload = await response.json() as ProviderEnvelope;
    if (!payload.id) throw new Error('E-sign provider did not return an envelope ID.');
    return payload;
  }

  createEnvelope(input: CreateEnvelopeInput) { return this.request('/envelopes', { method: 'POST', body: JSON.stringify(input) }); }
  getEnvelope(id: string) { return this.request(`/envelopes/${encodeURIComponent(id)}`); }
  resendEnvelope(id: string) { return this.request(`/envelopes/${encodeURIComponent(id)}/resend`, { method: 'POST', body: '{}' }); }
  voidEnvelope(id: string, reason: string) { return this.request(`/envelopes/${encodeURIComponent(id)}/void`, { method: 'POST', body: JSON.stringify({ reason }) }); }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const supplied = signature.replace(/^sha256=/u, '').trim().toLowerCase();
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
  }
}
