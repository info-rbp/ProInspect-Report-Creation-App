import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
  isCloudflareOriginProtectionConfigured,
  isTrustedCloudflareEdge,
  requestSourceIp,
} from '../src/security/trustedEdge.js';

function request(headers: Record<string, string> = {}, remoteAddress = '10.0.0.8'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe('Cloudflare trusted edge', () => {
  const env = { CLOUDFLARE_ORIGIN_SECRET: 'edge-secret-0123456789' } as NodeJS.ProcessEnv;

  it('requires an exact shared origin secret', () => {
    expect(isCloudflareOriginProtectionConfigured(env)).toBe(true);
    expect(isTrustedCloudflareEdge(request({ 'x-proinspect-origin-secret': 'wrong' }), env)).toBe(false);
    expect(isTrustedCloudflareEdge(request({ 'x-proinspect-origin-secret': 'edge-secret-0123456789' }), env)).toBe(true);
  });

  it('trusts the forwarded client IP only for authenticated edge traffic', () => {
    const headers = {
      'x-proinspect-origin-secret': 'edge-secret-0123456789',
      'x-proinspect-client-ip': '203.0.113.25',
    };
    expect(requestSourceIp(request(headers), env)).toBe('203.0.113.25');
    expect(requestSourceIp(request({ 'x-proinspect-client-ip': '203.0.113.25' }), env)).toBe('10.0.0.8');
  });

  it('rejects malformed forwarded addresses even from the edge', () => {
    const headers = {
      'x-proinspect-origin-secret': 'edge-secret-0123456789',
      'x-proinspect-client-ip': 'not-an-ip',
    };
    expect(requestSourceIp(request(headers), env)).toBe('10.0.0.8');
  });
});
