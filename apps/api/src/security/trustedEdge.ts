import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const resolved = Array.isArray(value) ? value[0] : value;
  const trimmed = resolved?.trim();
  return trimmed || undefined;
}

function configuredSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.CLOUDFLARE_ORIGIN_SECRET?.trim();
  return value || undefined;
}

export function isCloudflareOriginProtectionConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(configuredSecret(env));
}

export function isTrustedCloudflareEdge(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = configuredSecret(env);
  const presented = header(req, 'x-proinspect-origin-secret');
  if (!expected || !presented) return false;

  const expectedBytes = Buffer.from(expected, 'utf8');
  const presentedBytes = Buffer.from(presented, 'utf8');
  if (expectedBytes.length !== presentedBytes.length) return false;
  return timingSafeEqual(expectedBytes, presentedBytes);
}

export function requestSourceIp(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (isTrustedCloudflareEdge(req, env)) {
    const forwarded = header(req, 'x-proinspect-client-ip');
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  return req.socket.remoteAddress;
}
