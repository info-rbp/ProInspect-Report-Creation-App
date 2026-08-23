function shouldProxy(pathname) {
  return pathname === '/health' || pathname.startsWith('/api/') || pathname.startsWith('/v1/');
}

function jsonError(status, code, message) {
  return Response.json(
    { error: { status, code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function resolveGoogleApiOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const url = new URL(value.trim());
  const isLocal = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error('GOOGLE_API_ORIGIN must use HTTPS outside local development.');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('GOOGLE_API_ORIGIN must be an origin only, without credentials, query parameters or fragments.');
  }

  return url.origin;
}

async function proxyToGoogle(request, env) {
  let origin;
  try {
    origin = resolveGoogleApiOrigin(env.GOOGLE_API_ORIGIN);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'edge.configuration.invalid',
      message: error instanceof Error ? error.message : String(error),
    }));
    return jsonError(500, 'EDGE_CONFIGURATION_INVALID', 'The application edge is not configured correctly.');
  }

  if (!origin) {
    return jsonError(503, 'UPSTREAM_NOT_CONFIGURED', 'The Google API origin has not been configured.');
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, `${origin}/`);
  const upstreamRequest = new Request(upstreamUrl.toString(), request);
  upstreamRequest.headers.delete('host');
  upstreamRequest.headers.set('x-forwarded-host', incomingUrl.host);
  upstreamRequest.headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));
  upstreamRequest.headers.set('x-proinspect-edge', 'cloudflare');

  try {
    const response = await fetch(upstreamRequest);
    console.log(JSON.stringify({
      event: 'edge.proxy',
      method: request.method,
      path: incomingUrl.pathname,
      status: response.status,
      ray: request.headers.get('cf-ray'),
    }));
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'edge.upstream.error',
      method: request.method,
      path: incomingUrl.pathname,
      message: error instanceof Error ? error.message : String(error),
      ray: request.headers.get('cf-ray'),
    }));
    return jsonError(502, 'UPSTREAM_UNAVAILABLE', 'The application API is temporarily unavailable.');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (shouldProxy(url.pathname)) return proxyToGoogle(request, env);
    return env.ASSETS.fetch(request);
  },
};
