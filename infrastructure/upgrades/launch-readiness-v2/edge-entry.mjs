import application from '../../../cloudflare/worker.js';
const { Response } = globalThis;
export default {
  async fetch(request, env, context) {
    let response;
    if (new URL(request.url).pathname === '/__launch/revision') {
      response = Response.json({ commit: env.RELEASE_SHA }, { headers: {'cache-control':'no-store'} });
    } else response = await application.fetch(request,env,context);
    const secured = new Response(response.body,response);
    secured.headers.set('strict-transport-security','max-age=31536000');
    secured.headers.set('x-content-type-options','nosniff');
    secured.headers.set('referrer-policy','same-origin');
    secured.headers.set('permissions-policy','geolocation=(self), camera=(self), microphone=(self)');
    if(env.CONTENT_SECURITY_POLICY) secured.headers.set('content-security-policy',env.CONTENT_SECURITY_POLICY);
    return secured;
  }
};
