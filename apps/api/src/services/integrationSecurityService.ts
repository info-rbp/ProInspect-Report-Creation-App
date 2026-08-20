import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export interface EncryptedSecret {
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function decodeEncryptionKey(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY is required.');
  const asHex = /^[a-f0-9]{64}$/iu.test(raw) ? Buffer.from(raw, 'hex') : undefined;
  const asBase64 = asHex || Buffer.from(raw, 'base64');
  if (asBase64.length !== 32) {
    throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return asBase64;
}

export function encryptIntegrationSecret(value: unknown, additionalData: string): EncryptedSecret {
  const key = decodeEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(additionalData, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    keyVersion: process.env.INTEGRATION_TOKEN_KEY_VERSION?.trim() || 'v1',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptIntegrationSecret<T>(secret: EncryptedSecret, additionalData: string): T {
  if (secret.algorithm !== 'aes-256-gcm') throw new Error('Unsupported integration credential algorithm.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeEncryptionKey(),
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(additionalData, 'utf8'));
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function payloadSha256(rawBody: Buffer | string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function verifyShopifyWebhookHmac(
  rawBody: Buffer,
  receivedHmac: string | undefined,
  secret = process.env.SHOPIFY_WEBHOOK_SECRET,
): boolean {
  if (!receivedHmac?.trim() || !secret?.trim()) return false;
  const expected = createHmac('sha256', secret.trim()).update(rawBody).digest('base64');
  return equalText(expected, receivedHmac.trim());
}

export interface OAuthStatePayload {
  agencyId: string;
  provider: 'google_calendar' | 'xero';
  nonce: string;
  issuedAt: number;
  returnPath?: string;
}

function stateSecret(): string {
  const value = process.env.INTEGRATION_STATE_SECRET?.trim();
  if (!value) throw new Error('INTEGRATION_STATE_SECRET is required.');
  return value;
}

export function signOAuthState(payload: OAuthStatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(
  value: string,
  maxAgeSeconds = 15 * 60,
  expectedProvider?: OAuthStatePayload['provider'],
): OAuthStatePayload {
  const [encoded, received] = value.split('.');
  if (!encoded || !received) throw new Error('OAuth state is malformed.');
  const expected = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
  if (!equalText(expected, received)) throw new Error('OAuth state signature is invalid.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (
    !['google_calendar', 'xero'].includes(payload.provider) ||
    !payload.agencyId ||
    !payload.nonce ||
    (expectedProvider && payload.provider !== expectedProvider)
  ) {
    throw new Error('OAuth state payload is invalid.');
  }
  if (!Number.isFinite(payload.issuedAt) || Date.now() - payload.issuedAt > maxAgeSeconds * 1000) {
    throw new Error('OAuth state has expired.');
  }
  return payload;
}

export function verifyCalendarChannelToken(
  received: string | undefined,
  expected: string | undefined,
): boolean {
  return Boolean(received && expected && equalText(received, expected));
}
