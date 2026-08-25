const baseUrl = (process.env.API_BASE_URL || '').replace(/\/$/u, '');
const token = process.env.API_BEARER_TOKEN || '';
const agencyId = process.env.API_AGENCY_ID || '';
if (!baseUrl || !token || !agencyId) {
  console.error('API_BASE_URL, API_BEARER_TOKEN and API_AGENCY_ID are required.');
  process.exit(64);
}

const routes = [
  '/health',
  '/api/v1/dashboard/overview?range=30d&timezone=Australia%2FPerth',
  '/api/v1/dashboard/snapshots',
  '/api/v1/inspection-route-plans',
  '/api/v1/jurisdiction-policies',
  '/api/v1/document-packets',
  '/api/v1/communication-threads',
  '/api/v1/communication-messages',
  '/api/v1/compliance-obligations',
  '/api/v1/key-register',
  '/api/v1/pms-connections',
  '/api/v1/remote-inspection-assignments',
  '/api/v1/properties',
  '/api/v1/inspection-jobs',
  '/api/v1/reports',
  '/api/v1/maintenance-items',
  '/api/v1/tenants',
  '/api/v1/tenancies',
];

let failed = false;
for (const route of routes) {
  const headers = route === '/health' ? {} : { authorization:`Bearer ${token}`, 'x-agency-id':agencyId, accept:'application/json' };
  const response = await fetch(`${baseUrl}${route}`, { headers });
  const body = await response.text();
  const routeMissing = response.status === 404 && /route not found/i.test(body);
  const ok = response.ok || (!routeMissing && [400,401,403,409].includes(response.status));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${response.status} ${route}`);
  if (!ok) { failed = true; console.error(body.slice(0,500)); }
}
if (failed) process.exit(1);
