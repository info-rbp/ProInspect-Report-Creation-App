import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  payloadSha256,
  signOAuthState,
  verifyOAuthState,
  verifyShopifyWebhookHmac,
} from '../src/services/integrationSecurityService.js';
import {
  defaultShopifyServiceMappings,
  matchShopifyServiceMapping,
  parseShopifyOrderWebhook,
  shopifyAccessInstructions,
  shopifyPropertyAddress,
} from '../src/services/shopifyAdminService.js';
import {
  defaultGoogleCalendarServiceMappings,
  googleCalendarReference,
  isCalendarEventEligibleForInspection,
  matchCalendarServiceMapping,
} from '../src/services/googleCalendarService.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('integration secret and webhook security', () => {
  it('encrypts provider credentials with authenticated associated data', () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const encrypted = encryptIntegrationSecret(
      { accessToken: 'secret-token', refreshToken: 'refresh-token' },
      'agency-1:shopify',
    );
    expect(encrypted.ciphertext).not.toContain('secret-token');
    expect(
      decryptIntegrationSecret<{ accessToken: string }>(encrypted, 'agency-1:shopify'),
    ).toEqual(expect.objectContaining({ accessToken: 'secret-token' }));
    expect(() =>
      decryptIntegrationSecret(encrypted, 'agency-2:shopify'),
    ).toThrow();
  });

  it('verifies Shopify HMAC against the raw request bytes', () => {
    const body = Buffer.from(JSON.stringify({ id: 123, name: '#1001' }));
    const secret = 'shopify-webhook-secret';
    const hmac = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyShopifyWebhookHmac(body, hmac, secret)).toBe(true);
    expect(verifyShopifyWebhookHmac(Buffer.from('{}'), hmac, secret)).toBe(false);
    expect(payloadSha256(body)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('signs and expires Google OAuth state', () => {
    process.env.INTEGRATION_STATE_SECRET = 'state-secret-for-tests';
    const signed = signOAuthState({
      agencyId: 'agency-1',
      provider: 'google_calendar',
      nonce: 'nonce-1',
      issuedAt: Date.now(),
      returnPath: '/app/admin/jobs?tab=sync',
    });
    expect(verifyOAuthState(signed)).toEqual(
      expect.objectContaining({ agencyId: 'agency-1', nonce: 'nonce-1' }),
    );
    const [body] = signed.split('.');
    expect(() => verifyOAuthState(`${body}.invalid`)).toThrow('signature');
  });
});

describe('Shopify inspection order ingestion', () => {
  it('parses inspection order identity, service line and checkout address fields', () => {
    const payload = {
      id: 9876,
      admin_graphql_api_id: 'gid://shopify/Order/9876',
      name: '#1001',
      financial_status: 'paid',
      currency: 'AUD',
      current_total_price: '285.00',
      created_at: '2026-08-21T00:00:00.000Z',
      updated_at: '2026-08-21T01:00:00.000Z',
      note_attributes: [
        { name: 'Property Address', value: '15/88 Beaufort Street, Highgate WA 6003' },
        { name: 'Access Details', value: 'Concierge has swipe fob' },
      ],
      customer: {
        id: 42,
        first_name: 'Example',
        last_name: 'Customer',
        email: 'customer@example.com',
      },
      line_items: [
        {
          id: 111,
          product_id: 10264785191194,
          title: 'Property Condition Report',
          quantity: 1,
          price: '285.00',
        },
      ],
    };
    const order = parseShopifyOrderWebhook(payload, 'proinspect.myshopify.com');
    expect(order.orderGid).toBe('gid://shopify/Order/9876');
    expect(order.customerName).toBe('Example Customer');
    expect(order.lines[0]?.productId).toBe('gid://shopify/Product/10264785191194');
    expect(shopifyPropertyAddress(payload)).toContain('Beaufort');
    expect(shopifyAccessInstructions(payload)).toContain('Concierge');
  });

  it('matches the connected ProInspect product catalogue to canonical report types', () => {
    const mappings = defaultShopifyServiceMappings('agency-1');
    const mapping = matchShopifyServiceMapping(
      {
        shopDomain: 'proinspect.myshopify.com',
        orderGid: 'gid://shopify/Order/1',
        orderNumber: '#1001',
        financialStatus: 'paid',
        lines: [
          {
            lineItemId: 'line-1',
            productId: 'gid://shopify/Product/10265691390234',
            title: 'Exit Inspection',
            quantity: 1,
          },
        ],
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      },
      mappings,
    );
    expect(mapping?.serviceCode).toBe('exit-inspection');
    expect(mapping?.reportType).toBe('Exit Inspection');
  });
});

describe('Google Calendar booking ingestion', () => {
  it('converts a timed ProInspect event to a stable booking reference', () => {
    const reference = googleCalendarReference(
      {
        id: 'event-1',
        iCalUID: 'event-1@example.com',
        status: 'confirmed',
        summary: 'ProInspect: Routine Inspection',
        description: 'Property Address: 15/88 Beaufort Street, Highgate WA 6003',
        start: {
          dateTime: '2026-08-25T09:00:00+08:00',
          timeZone: 'Australia/Perth',
        },
        end: {
          dateTime: '2026-08-25T09:30:00+08:00',
          timeZone: 'Australia/Perth',
        },
      },
      'calendar-1',
    );
    expect(reference).toEqual(
      expect.objectContaining({
        eventId: 'event-1',
        eventStatus: 'confirmed',
        timezone: 'Australia/Perth',
      }),
    );
  });

  it('matches inspection appointment summaries and rejects ordinary blockouts', () => {
    const mappings = defaultGoogleCalendarServiceMappings('agency-1');
    const inspectionEvent = {
      id: 'event-1',
      summary: 'ProInspect: Routine Inspection (30 minutes)',
      status: 'confirmed',
      start: { dateTime: '2026-08-25T09:00:00+08:00' },
      end: { dateTime: '2026-08-25T09:30:00+08:00' },
    };
    const mapping = matchCalendarServiceMapping(inspectionEvent, mappings);
    expect(mapping?.reportType).toBe('Routine Inspection');
    expect(isCalendarEventEligibleForInspection(inspectionEvent, mapping)).toBe(true);
    expect(
      isCalendarEventEligibleForInspection(
        {
          id: 'event-2',
          summary: 'Block Out',
          status: 'confirmed',
          start: { dateTime: '2026-08-25T10:00:00+08:00' },
          end: { dateTime: '2026-08-25T11:00:00+08:00' },
        },
        undefined,
      ),
    ).toBe(false);
  });
});
