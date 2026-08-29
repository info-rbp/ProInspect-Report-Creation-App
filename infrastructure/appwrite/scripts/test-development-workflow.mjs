import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  Client,
  Permission,
  Query,
  Role,
  Storage,
  TablesDB,
  Users,
} from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import {
  AppwriteFoundationService,
  AppwriteTablesGateway,
} from '@pcr/appwrite-server';
import { assertDevelopmentTarget } from './safety.mjs';

const target = assertDevelopmentTarget({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
}, process.env.APPWRITE_CONFIRM_TEST);
if (!process.env.APPWRITE_API_KEY || !process.env.APPWRITE_SEED_PASSWORD) {
  throw new Error('APPWRITE_API_KEY and APPWRITE_SEED_PASSWORD are required.');
}

const databaseId = 'proinspect_core';
const authorisedUserId = 'dev_building_manager';
const unauthorisedUserId = 'dev_contractor';
const serverClient = new Client().setEndpoint(target.endpoint).setProject(target.projectId).setKey(process.env.APPWRITE_API_KEY);
const serverTables = new TablesDB(serverClient);
const serverStorage = new Storage(serverClient);
const serverUsers = new Users(serverClient);
const gateway = new AppwriteTablesGateway(serverTables, databaseId);
const service = new AppwriteFoundationService(gateway);
const correlationId = `dev-e2e-${randomUUID()}`;
let requestId;
let fileId;
let evidenceRowId;
let auditRows = [];

async function authenticate(userId) {
  const response = await fetch(`${target.endpoint}/account/sessions/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-appwrite-project': target.projectId },
    body: JSON.stringify({ email: `${userId}@example.com`, password: process.env.APPWRITE_SEED_PASSWORD }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Email/password authentication failed for ${userId} with HTTP ${response.status}.`);
  const fallback = response.headers.get('x-fallback-cookies');
  const fallbackCookies = fallback ? JSON.parse(fallback) : {};
  const session = payload.secret || fallbackCookies[`a_session_${target.projectId}`];
  if (!session) throw new Error(`Email/password authentication for ${userId} returned no usable session.`);
  return session;
}

function userServices(session) {
  const client = new Client().setEndpoint(target.endpoint).setProject(target.projectId).setSession(session);
  return { tables: new TablesDB(client), storage: new Storage(client) };
}

try {
  const [authorisedSession, unauthorisedSession] = await Promise.all([
    authenticate(authorisedUserId),
    authenticate(unauthorisedUserId),
  ]);
  const authorised = userServices(authorisedSession);
  const unauthorised = userServices(unauthorisedSession);

  const agencyMemberships = await authorised.tables.listRows({
    databaseId,
    tableId: 'agency_memberships',
    queries: [Query.equal('userId', [authorisedUserId]), Query.limit(10)],
  });
  if (agencyMemberships.total !== 1 || agencyMemberships.rows[0].agencyId !== 'dev_agency') throw new Error('Agency membership resolution failed.');

  const siteMemberships = await authorised.tables.listRows({
    databaseId,
    tableId: 'site_memberships',
    queries: [Query.equal('userId', [authorisedUserId]), Query.limit(10)],
  });
  const siteIds = siteMemberships.rows.map((item) => item.managedSiteId);
  if (!siteIds.includes('dev_site_strata')) throw new Error('Site membership resolution failed.');

  const sites = await authorised.tables.listRows({
    databaseId,
    tableId: 'managed_sites',
    queries: [Query.equal('$id', siteIds), Query.limit(10)],
  });
  if (!sites.rows.some((item) => item.$id === 'dev_site_strata')) throw new Error('Permitted ManagedSite retrieval failed.');

  const properties = await authorised.tables.listRows({
    databaseId,
    tableId: 'properties',
    queries: [Query.equal('managedSiteId', siteIds), Query.limit(100)],
  });
  if (!properties.rows.some((item) => item.$id === 'dev_property_unit_1')) throw new Error('Permitted Property retrieval failed.');

  const request = await service.createServiceRequest({
    agencyId: 'dev_agency',
    managedSiteId: 'dev_site_strata',
    propertyId: 'dev_property_unit_1',
    serviceDefinitionId: 'dev_service_routine',
    source: 'development_e2e',
    sourceReference: correlationId,
    requestedByUserId: authorisedUserId,
    notes: 'DEV TEST - live Appwrite workflow verification',
    correlationId,
    readScope: { userIds: [authorisedUserId] },
  });
  requestId = request.$id;
  const retrievedRequest = await authorised.tables.getRow({ databaseId, tableId: 'service_requests', rowId: requestId });
  if (retrievedRequest.sourceReference !== correlationId) throw new Error('ServiceRequest retrieval failed.');

  const auditResult = await authorised.tables.listRows({
    databaseId,
    tableId: 'audit_events',
    queries: [Query.equal('correlationId', [correlationId]), Query.limit(10)],
  });
  auditRows = auditResult.rows;
  if (!auditRows.some((item) => item.action === 'service_request.created' && item.entityId === requestId)) throw new Error('AuditEvent creation/retrieval failed.');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  fileId = randomUUID();
  const filePermissions = [Permission.read(Role.user(authorisedUserId))];
  await serverStorage.createFile({
    bucketId: 'inspection-evidence',
    fileId,
    file: InputFile.fromBuffer(png, 'dev-e2e-evidence.png'),
    permissions: filePermissions,
  });
  evidenceRowId = randomUUID();
  const now = new Date().toISOString();
  await serverTables.createRow({
    databaseId,
    tableId: 'evidence_files',
    rowId: evidenceRowId,
    permissions: filePermissions,
    data: {
      agencyId: 'dev_agency',
      managedSiteId: 'dev_site_strata',
      propertyId: 'dev_property_unit_1',
      bucketId: 'inspection-evidence',
      fileId,
      entityType: 'service_request',
      entityId: requestId,
      category: 'development_test',
      mimeType: 'image/png',
      originalFilename: 'dev-e2e-evidence.png',
      size: png.length,
      checksum: createHash('sha256').update(png).digest('hex'),
      uploadedBy: authorisedUserId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  });
  const downloaded = await authorised.storage.getFileDownload({ bucketId: 'inspection-evidence', fileId });
  if (Buffer.from(downloaded).length !== png.length) throw new Error('Permitted evidence download did not return the uploaded file.');

  let denied = false;
  try { await unauthorised.storage.getFileDownload({ bucketId: 'inspection-evidence', fileId }); }
  catch (error) { denied = [401, 403, 404].includes(error?.code); }
  if (!denied) throw new Error('Unauthorised user was not denied evidence access.');

  console.log('Passed live Development workflow: authentication, membership/site/property resolution, transactional ServiceRequest+AuditEvent, evidence upload/download, and unauthorised denial.');
} finally {
  if (evidenceRowId) await serverTables.deleteRow({ databaseId, tableId: 'evidence_files', rowId: evidenceRowId }).catch(() => undefined);
  if (fileId) await serverStorage.deleteFile({ bucketId: 'inspection-evidence', fileId }).catch(() => undefined);
  for (const row of auditRows) await serverTables.deleteRow({ databaseId, tableId: 'audit_events', rowId: row.$id }).catch(() => undefined);
  if (requestId) await serverTables.deleteRow({ databaseId, tableId: 'service_requests', rowId: requestId }).catch(() => undefined);
  await Promise.all([
    serverUsers.deleteSessions({ userId: authorisedUserId }).catch(() => undefined),
    serverUsers.deleteSessions({ userId: unauthorisedUserId }).catch(() => undefined),
  ]);
}
