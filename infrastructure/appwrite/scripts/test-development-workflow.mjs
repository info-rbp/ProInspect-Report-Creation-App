import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Account,
  AuthenticationFactor,
  AuthenticatorType,
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
  canAccessFoundation,
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
const temporaryRows = [];
let rollbackProbeId;
let rollbackAuditProbeId;
let rollbackTransactionId;
let mfaProbeUserId;
let mfaProbeProfileId;
let mfaProbeMembershipId;

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
  return { account: new Account(client), tables: new TablesDB(client), storage: new Storage(client) };
}

function base32Bytes(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.toUpperCase().replaceAll('=', '').replace(/[^A-Z2-7]/gu, '');
  let bits = '';
  for (const character of clean) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Bytes(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

async function expectDenied(operation, label) {
  let denied = false;
  try { await operation(); }
  catch (error) { denied = [401, 403, 404].includes(error?.code); }
  if (!denied) throw new Error(`${label} was not denied.`);
}

try {
  const [authorisedSession, unauthorisedSession, inspectorSession, residentSession, otherResidentSession, adminSession] = await Promise.all([
    authenticate(authorisedUserId),
    authenticate(unauthorisedUserId),
    authenticate('dev_inspector'),
    authenticate('dev_resident_tenant'),
    authenticate('dev_resident_owner'),
    authenticate('dev_admin'),
  ]);
  const authorised = userServices(authorisedSession);
  const unauthorised = userServices(unauthorisedSession);
  const inspector = userServices(inspectorSession);
  const resident = userServices(residentSession);
  const otherResident = userServices(otherResidentSession);
  const admin = userServices(adminSession);

  mfaProbeUserId = `dev_mfa_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  mfaProbeProfileId = mfaProbeUserId;
  mfaProbeMembershipId = `${mfaProbeUserId}_agency`;
  const mfaEmail = `${mfaProbeUserId}@example.com`;
  const mfaPermissions = [Permission.read(Role.user(mfaProbeUserId))];
  const mfaNow = new Date().toISOString();
  await serverUsers.create({ userId: mfaProbeUserId, email: mfaEmail, password: process.env.APPWRITE_SEED_PASSWORD, name: 'DEV TEST - MFA probe' });
  await serverTables.createRow({
    databaseId, tableId: 'user_profiles', rowId: mfaProbeProfileId, permissions: mfaPermissions,
    data: { userId: mfaProbeUserId, displayName: 'DEV TEST - MFA probe', email: mfaEmail, status: 'active', createdAt: mfaNow, updatedAt: mfaNow },
  });
  await serverTables.createRow({
    databaseId, tableId: 'agency_memberships', rowId: mfaProbeMembershipId, permissions: mfaPermissions,
    data: { userId: mfaProbeUserId, agencyId: 'dev_agency', role: 'proinspect_admin', status: 'active', mfaRequired: true, createdAt: mfaNow, updatedAt: mfaNow },
  });
  const mfaEnrollment = userServices(await authenticate(mfaProbeUserId));
  const authenticator = await mfaEnrollment.account.createMFAAuthenticator({ type: AuthenticatorType.Totp });
  await mfaEnrollment.account.updateMFAAuthenticator({ type: AuthenticatorType.Totp, otp: totp(authenticator.secret) });
  await mfaEnrollment.account.updateMFA({ mfa: true });
  const recoveryCodes = await mfaEnrollment.account.createMFARecoveryCodes();
  if (!recoveryCodes.recoveryCodes.length) throw new Error('MFA recovery codes were not generated.');
  await serverUsers.deleteSessions({ userId: mfaProbeUserId });
  const nextWindowDelay = 30_000 - (Date.now() % 30_000) + 750;
  await delay(nextWindowDelay);
  const mfaChallengeSession = userServices(await authenticate(mfaProbeUserId));
  const challenge = await mfaChallengeSession.account.createMFAChallenge({ factor: AuthenticationFactor.Totp });
  await mfaChallengeSession.account.updateMFAChallenge({ challengeId: challenge.$id, otp: totp(authenticator.secret) });
  const verifiedSession = await mfaChallengeSession.account.getSession({ sessionId: 'current' });
  if (!verifiedSession.factors.includes('totp')) throw new Error('The privileged test session did not record a verified TOTP factor.');
  await mfaChallengeSession.account.deleteSession({ sessionId: 'current' });
  await expectDenied(() => mfaChallengeSession.account.get(), 'Logged-out MFA probe session');

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

  await authorised.tables.getRow({ databaseId, tableId: 'managed_sites', rowId: 'dev_site_strata' });
  await expectDenied(
    () => authorised.tables.getRow({ databaseId, tableId: 'managed_sites', rowId: 'dev_site_commercial' }),
    'Cross-site building-manager access',
  );
  await resident.tables.getRow({ databaseId, tableId: 'resident_requests', rowId: 'dev_resident_request' });
  await expectDenied(
    () => otherResident.tables.getRow({ databaseId, tableId: 'resident_requests', rowId: 'dev_resident_request' }),
    'Other-resident request access',
  );
  await inspector.tables.getRow({ databaseId, tableId: 'inspection_jobs', rowId: 'dev_inspection_job' });
  await unauthorised.tables.getRow({ databaseId, tableId: 'maintenance_work_orders', rowId: 'dev_work_order' });

  const isolationNow = new Date().toISOString();
  const inspectorIsolationId = randomUUID();
  const contractorIsolationId = randomUUID();
  const adminOnly = [Permission.read(Role.user('dev_admin'))];
  await serverTables.createRow({
    databaseId, tableId: 'inspection_jobs', rowId: inspectorIsolationId, permissions: adminOnly,
    data: { agencyId: 'dev_agency', propertyId: 'dev_property_unit_1', inspectorId: 'dev_admin', inspectionType: 'Routine Inspection', priority: 'normal', status: 'assigned', version: 1, createdAt: isolationNow, updatedAt: isolationNow },
  });
  temporaryRows.push(['inspection_jobs', inspectorIsolationId]);
  await serverTables.createRow({
    databaseId, tableId: 'maintenance_work_orders', rowId: contractorIsolationId, permissions: adminOnly,
    data: { agencyId: 'dev_agency', maintenanceItemId: 'dev_maintenance_item', contractorId: 'dev_admin', status: 'assigned', version: 1, createdAt: isolationNow, updatedAt: isolationNow },
  });
  temporaryRows.push(['maintenance_work_orders', contractorIsolationId]);
  await expectDenied(
    () => inspector.tables.getRow({ databaseId, tableId: 'inspection_jobs', rowId: inspectorIsolationId }),
    'Unassigned inspector access',
  );
  await expectDenied(
    () => unauthorised.tables.getRow({ databaseId, tableId: 'maintenance_work_orders', rowId: contractorIsolationId }),
    'Unassigned contractor access',
  );

  const adminMemberships = await admin.tables.listRows({
    databaseId,
    tableId: 'agency_memberships',
    queries: [Query.equal('userId', ['dev_admin']), Query.limit(10)],
  });
  if (adminMemberships.total !== 1 || adminMemberships.rows[0].mfaRequired !== true) throw new Error('Privileged membership does not require MFA.');
  const adminPrincipal = { userId: 'dev_admin', agencyId: 'dev_agency', role: 'proinspect_admin', mfaVerified: false };
  if (canAccessFoundation(adminPrincipal, 'property.read', { agencyId: 'dev_agency' })) throw new Error('Password-only privileged access was not denied.');
  if (canAccessFoundation({ ...adminPrincipal, mfaVerified: true }, 'property.read', { agencyId: 'other_agency' })) throw new Error('Cross-agency privileged access was not denied.');
  if (!canAccessFoundation({ ...adminPrincipal, mfaVerified: true }, 'property.read', { agencyId: 'dev_agency' })) throw new Error('Verified-MFA privileged access was not allowed.');

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

  await expectDenied(
    () => unauthorised.storage.getFileDownload({ bucketId: 'inspection-evidence', fileId }),
    'Unauthorised evidence access',
  );

  rollbackProbeId = randomUUID();
  rollbackAuditProbeId = randomUUID();
  rollbackTransactionId = (await serverTables.createTransaction({ ttl: 60 })).$id;
  await serverTables.createRow({
    databaseId,
    tableId: 'audit_events',
    rowId: rollbackAuditProbeId,
    transactionId: rollbackTransactionId,
    permissions: filePermissions,
    data: {
      agencyId: 'dev_agency', actorUserId: authorisedUserId, actorType: 'user', action: 'service_request.rollback_probe',
      entityType: 'service_request', entityId: rollbackProbeId, source: 'proinspect_api', status: 'recorded',
      correlationId: `${correlationId}-rollback`,
      createdAt: now, updatedAt: now,
    },
  });
  let transactionRejected = false;
  try {
    await serverTables.createRow({
      databaseId,
      tableId: 'service_requests',
      rowId: rollbackProbeId,
      transactionId: rollbackTransactionId,
      permissions: filePermissions,
      data: {
        agencyId: 'dev_agency', managedSiteId: 'dev_site_strata', propertyId: 'dev_property_unit_1',
        serviceDefinitionId: 'dev_service_routine', source: 'development_e2e', sourceReference: correlationId,
        requestedByUserId: authorisedUserId, status: 'received', paymentStatus: 'not_required',
        schedulingStatus: 'not_required', priority: 'normal', createdAt: now, updatedAt: now,
      },
    });
    await serverTables.updateTransaction({ transactionId: rollbackTransactionId, commit: true });
  } catch {
    transactionRejected = true;
  }
  await serverTables.updateTransaction({ transactionId: rollbackTransactionId, rollback: true }).catch(() => undefined);
  rollbackTransactionId = undefined;
  if (!transactionRejected) throw new Error('The deliberate duplicate transaction was not rejected.');
  await expectDenied(
    () => serverTables.getRow({ databaseId, tableId: 'service_requests', rowId: rollbackProbeId }),
    'Rolled-back ServiceRequest visibility',
  );
  await expectDenied(
    () => serverTables.getRow({ databaseId, tableId: 'audit_events', rowId: rollbackAuditProbeId }),
    'Rolled-back AuditEvent visibility',
  );
  rollbackProbeId = undefined;
  rollbackAuditProbeId = undefined;

  console.log('Passed live Development workflow: email/password authentication and logout; membership resolution; TOTP enrolment, challenge and recovery codes; agency/site, resident, contractor and inspector isolation; privileged MFA denial; transactional ServiceRequest+AuditEvent; deliberate transaction rollback; evidence upload/download and unauthorised denial.');
} finally {
  if (rollbackTransactionId) await serverTables.updateTransaction({ transactionId: rollbackTransactionId, rollback: true }).catch(() => undefined);
  if (rollbackProbeId) await serverTables.deleteRow({ databaseId, tableId: 'service_requests', rowId: rollbackProbeId }).catch(() => undefined);
  if (rollbackAuditProbeId) await serverTables.deleteRow({ databaseId, tableId: 'audit_events', rowId: rollbackAuditProbeId }).catch(() => undefined);
  if (evidenceRowId) await serverTables.deleteRow({ databaseId, tableId: 'evidence_files', rowId: evidenceRowId }).catch(() => undefined);
  if (fileId) await serverStorage.deleteFile({ bucketId: 'inspection-evidence', fileId }).catch(() => undefined);
  for (const row of auditRows) await serverTables.deleteRow({ databaseId, tableId: 'audit_events', rowId: row.$id }).catch(() => undefined);
  for (const [tableId, rowId] of temporaryRows) await serverTables.deleteRow({ databaseId, tableId, rowId }).catch(() => undefined);
  if (requestId) await serverTables.deleteRow({ databaseId, tableId: 'service_requests', rowId: requestId }).catch(() => undefined);
  if (mfaProbeMembershipId) await serverTables.deleteRow({ databaseId, tableId: 'agency_memberships', rowId: mfaProbeMembershipId }).catch(() => undefined);
  if (mfaProbeProfileId) await serverTables.deleteRow({ databaseId, tableId: 'user_profiles', rowId: mfaProbeProfileId }).catch(() => undefined);
  if (mfaProbeUserId) await serverUsers.delete({ userId: mfaProbeUserId }).catch(() => undefined);
  await Promise.all([
    serverUsers.deleteSessions({ userId: authorisedUserId }).catch(() => undefined),
    serverUsers.deleteSessions({ userId: unauthorisedUserId }).catch(() => undefined),
    serverUsers.deleteSessions({ userId: 'dev_inspector' }).catch(() => undefined),
    serverUsers.deleteSessions({ userId: 'dev_resident_tenant' }).catch(() => undefined),
    serverUsers.deleteSessions({ userId: 'dev_resident_owner' }).catch(() => undefined),
    serverUsers.deleteSessions({ userId: 'dev_admin' }).catch(() => undefined),
  ]);
}
