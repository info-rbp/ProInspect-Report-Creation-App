import {
  insertAfter,
  insertBefore,
  replaceOnce,
  replaceSection,
} from './patch-lib.mjs';

const clientApprovalTable = `  agencyEntity('client_approvals', [str('propertyId',36,true),str('maintenanceItemId',36,true),str('clientId',36,true),str('clientContactId',36),str('recipientEmail',320,true,'email'),text('summary',true),text('recommendedAction',true),str('priority',32,true),text('evidencePhotoIds'),text('clientNotes'),datetime('respondedAt'),str('accessGrantId',36),str('quoteId',36),str('quoteVersionId',36),str('quoteNumber',128),number('amount'),str('currency',3),datetime('quoteExpiresAt'),datetime('decisionTokenVerifiedAt'),integer('version',true)], [index('item_status',['maintenanceItemId','status']),index('client_status',['clientId','status']),index('recipient_status',['recipientEmail','status'])]),\n`;

const collectionCodec = `
function collectionWriteData(
  collection: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (collection !== 'clientApprovals') return input;
  return {
    ...input,
    ...(Array.isArray(input.evidencePhotoIds)
      ? { evidencePhotoIds: JSON.stringify(input.evidencePhotoIds) }
      : {}),
  };
}

function collectionReadRecord(
  collection: string,
  row: Record<string, unknown>,
): StoredRecord {
  const value = publicRecord(row);
  if (collection === 'clientApprovals' && typeof value.evidencePhotoIds === 'string') {
    try { value.evidencePhotoIds = JSON.parse(value.evidencePhotoIds) as unknown[]; }
    catch { value.evidencePhotoIds = []; }
  }
  return value;
}

`;

const automationRoute = `
function automationSecretMatches(req: IncomingMessage): boolean {
  const supplied = req.headers['x-proinspect-automation-secret']?.toString();
  const expected = process.env.AUTOMATION_RUNNER_SECRET?.trim();
  if (!supplied || !expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function automationGrant(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse> {
  if (!automationSecretMatches(req)) {
    throw new ApiError(403, 'AUTOMATION_SECRET_INVALID', 'Automation grant issuance is not authorised.');
  }
  const body = await readJson(req);
  const agencyId = requiredString(body, 'agencyId');
  const tenantId = requiredString(body, 'tenantId');
  const tenancyId = requiredString(body, 'tenancyId');
  const recipientEmail = validEmail(requiredString(body, 'recipientEmail'));
  await assertVerifiedParticipant(dependencies, agencyId, tenantId, tenancyId, recipientEmail);
  const created = await createGrant(dependencies, agencyId, tenantId, tenancyId, recipientEmail, 24 * 7, 'system:tenant-automation');
  await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: 'system:tenant-automation', actorRole: 'operations', agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: 'tenant_portal.automation_grant_generated', target: { agencyId, tenancyId }, correlationId });
  return { status: 201, body: { data: { grantId: created.grant.id, accessUrl: created.accessUrl, expiresAt: created.grant.expiresAt }, meta: { correlationId } } };
}

`;

const workerPortalLink = `async function portalLink(agencyId: string, tenantId: string, tenancyId: string, recipientEmail: string): Promise<string> {
  const apiBase = process.env.PROINSPECT_API_BASE_URL?.trim().replace(/\\\/$/u, '');
  const secret = process.env.AUTOMATION_RUNNER_SECRET?.trim();
  if (!apiBase || !secret) throw new Error('PROINSPECT_API_BASE_URL and AUTOMATION_RUNNER_SECRET are required for tenant portal automation.');
  const response = await fetch(\`\${apiBase}/api/v1/internal/tenant-portal-grants/automation\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-proinspect-automation-secret': secret },
    body: JSON.stringify({ agencyId, tenantId, tenancyId, recipientEmail }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as { data?: { accessUrl?: string }; error?: { message?: string } };
  if (!response.ok || !payload.data?.accessUrl) throw new Error(payload.error?.message || \`Tenant portal grant API failed with \${response.status}.\`);
  const web = webBaseUrl();
  if (!web) throw new Error('WEB_APP_BASE_URL is required for tenant portal automation.');
  return new URL(payload.data.accessUrl, \`\${web}/\`).toString();
}

`;

export async function applyStage04() {
  replaceOnce(
    'apps/api/src/backend/appwriteAdapters.ts',
    "  agencyMemberships: 'agency_memberships', siteMemberships: 'site_memberships', clients: 'clients',\n  clientContacts: 'client_contacts', properties: 'properties', buildings: 'buildings',",
    "  agencyMemberships: 'agency_memberships', siteMemberships: 'site_memberships', clients: 'clients',\n  clientContacts: 'client_contacts', clientApprovals: 'client_approvals', properties: 'properties', buildings: 'buildings',",
    'clientApprovals Appwrite mapping',
  );
  insertBefore('apps/api/src/backend/appwriteAdapters.ts', 'export function createAppwriteApiServices(', collectionCodec, 'collection codec helpers');
  replaceOnce('apps/api/src/backend/appwriteAdapters.ts', '    const items = result.rows.map((row) => publicRecord(row as unknown as Record<string, unknown>));', '    const items = result.rows.map((row) => collectionReadRecord(collection, row as unknown as Record<string, unknown>));', 'collection-aware list decoding');
  replaceOnce('apps/api/src/backend/appwriteAdapters.ts', '      const record = publicRecord(row as unknown as Record<string, unknown>);', '      const record = collectionReadRecord(collection, row as unknown as Record<string, unknown>);', 'collection-aware get decoding');
  replaceOnce('apps/api/src/backend/appwriteAdapters.ts', '      data: writeData({ ...data, agencyId }, actorId), permissions: [],', '      data: writeData(collectionWriteData(collection, { ...data, agencyId }), actorId), permissions: [],', 'collection-aware create encoding');
  replaceOnce('apps/api/src/backend/appwriteAdapters.ts', '    return publicRecord(row as unknown as Record<string, unknown>);\n  }\n\n  async update(collection:', '    return collectionReadRecord(collection, row as unknown as Record<string, unknown>);\n  }\n\n  async update(collection:', 'collection-aware create decoding');
  replaceOnce('apps/api/src/backend/appwriteAdapters.ts', '    const patch = writeData(data, actorId, current);', '    const patch = writeData(collectionWriteData(collection, data), actorId, current);', 'collection-aware update encoding');
  replaceOnce('apps/api/src/backend/appwriteAdapters.ts', '    return publicRecord(row as unknown as Record<string, unknown>);\n  }\n}\n\nfunction appwriteErrorCode', '    return collectionReadRecord(collection, row as unknown as Record<string, unknown>);\n  }\n}\n\nfunction appwriteErrorCode', 'collection-aware update decoding');

  insertAfter('infrastructure/appwrite/tables/schema.mjs', "  agencyEntity('maintenance_approvals', [str('maintenanceItemId',36,true),str('quoteId',36),str('approvedBy',36),str('decision',32,true),text('reason'),datetime('decidedAt')], [index('item_decision',['maintenanceItemId','decision'])]),\n", clientApprovalTable, 'client approvals table');
  replaceOnce('infrastructure/appwrite/tables/schema.test.mjs', "'external_access_grants'])", "'external_access_grants','client_approvals'])", 'client approvals schema contract');
  replaceOnce('infrastructure/appwrite/tables/schema.test.mjs', 'expect(allTables).toHaveLength(119);', 'expect(allTables).toHaveLength(120);', '120-table Stage 4 baseline');

  replaceOnce('apps/api/src/backend/tenantPortalRoutes.ts', "import { createHash, randomUUID } from 'node:crypto';", "import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';", 'tenant automation timing-safe import');
  insertBefore('apps/api/src/backend/tenantPortalRoutes.ts', 'async function generateGrant(', automationRoute, 'internal automation grant route');
  insertAfter('apps/api/src/backend/tenantPortalRoutes.ts', "  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;\n", "  if (parts[2] === 'internal' && parts[3] === 'tenant-portal-grants' && parts[4] === 'automation' && req.method === 'POST') return automationGrant(req, dependencies, correlationId);\n", 'internal tenant automation route mount');

  replaceSection(
    'apps/notification-worker/src/index.ts',
    'async function portalLink(',
    'async function emitAutomationNotification',
    workerPortalLink,
    'notification index canonical tenant grant API',
  );
  replaceSection(
    'apps/notification-worker/src/runtime.ts',
    'async function portalLink(',
    'async function queueTenantEvent',
    workerPortalLink,
    'notification runtime canonical tenant grant API',
  );
}
