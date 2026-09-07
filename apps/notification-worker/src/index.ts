import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { firestoreDb } from './firestoreDatabase.js';

interface ProviderConfig {
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
  sendgridFromName?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  callbackBaseUrl?: string;
  callbackSecret?: string;
}

interface NotificationJob {
  id?: string;
  agencyId?: string;
  tenantId?: string;
  tenancyId?: string;
  propertyId?: string;
  channel: 'email' | 'sms' | 'portal';
  recipient: string;
  subject?: string;
  message: string;
  communicationId?: string;
  status?: string;
  queuedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  providerMessageId?: string;
}

interface TenantRecord {
  id: string;
  email?: string;
  phone?: string;
  fullName?: string;
}

interface TenancyRecord {
  id: string;
  leaseEndDate?: string;
  lifecycleStatus?: string;
  status?: string;
}

interface ParticipantRecord {
  id: string;
  tenantId: string;
  tenancyId: string;
  role?: string;
  status?: string;
}

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

async function metadataAccessToken(): Promise<string> {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Metadata token request failed with ${response.status}.`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error('Metadata token response did not contain access_token.');
  return body.access_token;
}

async function secretProviderConfig(): Promise<ProviderConfig> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) return {};
  try {
    const token = await metadataAccessToken();
    const response = await fetch(`https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/email-provider-config/versions/latest:access`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return {};
    const body = await response.json() as { payload?: { data?: string } };
    const encoded = body.payload?.data;
    if (!encoded) return {};
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as ProviderConfig;
  } catch {
    return {};
  }
}

let providerCache: { value: ProviderConfig; expiresAt: number } | undefined;
async function providerConfig(): Promise<ProviderConfig> {
  if (providerCache && providerCache.expiresAt > Date.now()) return providerCache.value;
  let parsed: ProviderConfig = {};
  const raw = process.env.NOTIFICATION_PROVIDER_CONFIG?.trim();
  if (raw) {
    try { parsed = JSON.parse(raw) as ProviderConfig; }
    catch { console.error(JSON.stringify({ level: 'error', message: 'notification.config.invalid_json' })); }
  } else {
    parsed = await secretProviderConfig();
  }
  const value: ProviderConfig = {
    ...parsed,
    sendgridApiKey: process.env.SENDGRID_API_KEY?.trim() || parsed.sendgridApiKey,
    sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL?.trim() || parsed.sendgridFromEmail,
    sendgridFromName: process.env.SENDGRID_FROM_NAME?.trim() || parsed.sendgridFromName,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || parsed.twilioAccountSid,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim() || parsed.twilioAuthToken,
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || parsed.twilioFromNumber,
    callbackBaseUrl: process.env.NOTIFICATION_CALLBACK_BASE_URL?.trim() || parsed.callbackBaseUrl,
    callbackSecret: process.env.NOTIFICATION_CALLBACK_SECRET?.trim() || parsed.callbackSecret,
  };
  providerCache = { value, expiresAt: Date.now() + 5 * 60_000 };
  return value;
}

function webBaseUrl(): string {
  const configured = process.env.WEB_APP_BASE_URL?.trim().replace(/\/$/u, '');
  if (configured) return configured;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  return projectId ? `https://${projectId}.web.app` : '';
}

function normalizedMessage(message: string): string {
  const base = webBaseUrl();
  if (!base) return message;
  return message.replace(/(^|\s)(\/tenant-portal\/[A-Za-z0-9%._~-]+)/gu, (_match, prefix: string, path: string) => `${prefix}${base}${path}`);
}

async function readBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw Object.assign(new Error('Payload too large.'), { status: 413 });
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function decodePubSub(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new Error('Pub/Sub body is required.');
  const body = input as Record<string, unknown>;
  const message = body.message;
  if (message && typeof message === 'object') {
    const data = (message as Record<string, unknown>).data;
    if (typeof data !== 'string') throw new Error('Pub/Sub message data is required.');
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as Record<string, unknown>;
  }
  return body;
}

async function updateCommunication(agencyId: string, communicationId: string | undefined, patch: Record<string, unknown>) {
  if (!communicationId) return;
  await firestoreDb(adminApp()).doc(`agencies/${agencyId}/tenantCommunications/${communicationId}`).set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

async function sendEmail(agencyId: string, notificationId: string, job: NotificationJob, provider: ProviderConfig) {
  if (!provider.sendgridApiKey || !provider.sendgridFromEmail) throw new Error('SendGrid email delivery is not configured in email-provider-config.');
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.sendgridApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: job.recipient }],
        subject: job.subject || 'ProInspect notification',
        custom_args: { agencyId, notificationId, communicationId: job.communicationId || '' },
      }],
      from: { email: provider.sendgridFromEmail, ...(provider.sendgridFromName ? { name: provider.sendgridFromName } : {}) },
      content: [{ type: 'text/plain', value: normalizedMessage(job.message) }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SendGrid delivery failed with ${response.status}: ${await response.text().catch(() => '')}`);
  return response.headers.get('x-message-id') || undefined;
}

async function sendSms(agencyId: string, notificationId: string, job: NotificationJob, provider: ProviderConfig) {
  if (!provider.twilioAccountSid || !provider.twilioAuthToken || !provider.twilioFromNumber) throw new Error('Twilio SMS delivery is not configured in email-provider-config.');
  const form = new URLSearchParams({ To: job.recipient, From: provider.twilioFromNumber, Body: normalizedMessage(job.message) });
  if (provider.callbackBaseUrl && provider.callbackSecret) {
    const callback = new URL('/api/v1/external/notification-callbacks/twilio', provider.callbackBaseUrl);
    callback.searchParams.set('token', provider.callbackSecret);
    callback.searchParams.set('agencyId', agencyId);
    callback.searchParams.set('notificationId', notificationId);
    if (job.communicationId) callback.searchParams.set('communicationId', job.communicationId);
    form.set('StatusCallback', callback.toString());
  }
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(provider.twilioAccountSid)}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${provider.twilioAccountSid}:${provider.twilioAuthToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as { sid?: string; message?: string };
  if (!response.ok) throw new Error(`Twilio delivery failed with ${response.status}: ${payload.message || 'unknown error'}`);
  return payload.sid;
}

export async function deliverNotification(agencyId: string, notificationId: string, supplied?: NotificationJob): Promise<NotificationJob> {
  const database = firestoreDb(adminApp());
  const reference = database.doc(`agencies/${agencyId}/notificationJobs/${notificationId}`);
  const snapshot = await reference.get();
  const existing = snapshot.exists ? snapshot.data() as NotificationJob : supplied;
  if (!existing) throw new Error(`Notification job not found: ${notificationId}`);
  if (['sent', 'delivered'].includes(String(existing.status))) return existing;
  const provider = await providerConfig();
  const now = new Date().toISOString();
  try {
    let providerMessageId: string | undefined;
    let nextStatus: 'sent' | 'delivered' = 'sent';
    if (existing.channel === 'email') providerMessageId = await sendEmail(agencyId, notificationId, existing, provider);
    else if (existing.channel === 'sms') providerMessageId = await sendSms(agencyId, notificationId, existing, provider);
    else nextStatus = 'delivered';
    const patch = {
      status: nextStatus,
      sentAt: now,
      ...(nextStatus === 'delivered' ? { deliveredAt: now } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
      updatedAt: now,
      lastError: null,
    };
    await reference.set(patch, { merge: true });
    await updateCommunication(agencyId, existing.communicationId, patch);
    return { ...existing, ...patch, id: notificationId, agencyId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = Number((snapshot.data() as Record<string, unknown> | undefined)?.attempts || 0) + 1;
    await reference.set({ status: 'failed', lastError: message, attempts, updatedAt: now }, { merge: true });
    await updateCommunication(agencyId, existing.communicationId, { status: 'failed', lastError: message });
    throw error;
  }
}

function daysUntil(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.ceil((time - now.getTime()) / 86_400_000) : undefined;
}

function automationId(eventKey: string): string {
  return createHash('sha256').update(eventKey).digest('hex');
}

async function tenancyRecipients(tenancyId: string, participants: ParticipantRecord[], tenants: TenantRecord[]) {
  const ids = participants.filter((item) => item.tenancyId === tenancyId && item.status !== 'ended' && ['primary_tenant', 'co_tenant'].includes(String(item.role))).map((item) => item.tenantId);
  return tenants.filter((tenant) => ids.includes(tenant.id) && tenant.email?.trim()).map((tenant) => ({ tenantId: tenant.id, email: tenant.email!.trim().toLowerCase(), name: tenant.fullName || 'Tenant' }));
}

async function portalLink(agencyId: string, tenantId: string, tenancyId: string, recipientEmail: string): Promise<string> {
  const apiBase = process.env.PROINSPECT_API_BASE_URL?.trim().replace(/\/$/u, '');
  const secret = process.env.AUTOMATION_RUNNER_SECRET?.trim();
  if (!apiBase || !secret) throw new Error('PROINSPECT_API_BASE_URL and AUTOMATION_RUNNER_SECRET are required for tenant portal automation.');
  const response = await fetch(`${apiBase}/api/v1/internal/tenant-portal-grants/automation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-proinspect-automation-secret': secret },
    body: JSON.stringify({ agencyId, tenantId, tenancyId, recipientEmail }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as { data?: { accessUrl?: string }; error?: { message?: string } };
  if (!response.ok || !payload.data?.accessUrl) throw new Error(payload.error?.message || `Tenant portal grant API failed with ${response.status}.`);
  const web = webBaseUrl();
  if (!web) throw new Error('WEB_APP_BASE_URL is required for tenant portal automation.');
  return new URL(payload.data.accessUrl, `${web}/`).toString();
}

async function emitAutomationNotification(input: {
  agencyId: string;
  dateKey: string;
  rule: string;
  entityId: string;
  tenantId: string;
  tenancyId: string;
  recipient: string;
  subject: string;
  message: string;
  relatedEntityType: 'tenant_instruction' | 'tenancy_document' | 'general';
}): Promise<boolean> {
  const database = firestoreDb(adminApp());
  const eventKey = `${input.rule}:${input.entityId}:${input.tenantId}:${input.dateKey}`;
  const eventId = automationId(eventKey);
  const eventRef = database.doc(`agencies/${input.agencyId}/tenantAutomationEvents/${eventId}`);
  const communicationId = `auto-${eventId}`;
  const notificationId = `auto-${eventId}`;
  const existing = await eventRef.get();
  if (existing.exists && existing.data()?.status === 'completed') return false;

  if (!existing.exists) {
    await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(eventRef);
      if (snapshot.exists) return;
      const now = new Date().toISOString();
      transaction.create(eventRef, { id: eventId, eventKey, rule: input.rule, tenantId: input.tenantId, tenancyId: input.tenancyId, entityId: input.entityId, notificationId, communicationId, status: 'pending', createdAt: now, updatedAt: now });
      transaction.set(database.doc(`agencies/${input.agencyId}/tenantCommunications/${communicationId}`), { id: communicationId, agencyId: input.agencyId, tenantId: input.tenantId, tenancyId: input.tenancyId, channel: 'email', direction: 'outbound', subject: input.subject, message: input.message, status: 'queued', relatedEntityType: input.relatedEntityType, relatedEntityId: input.entityId, createdBy: 'system:tenant-automation', createdAt: now, updatedAt: now, version: 1 });
      transaction.set(database.doc(`agencies/${input.agencyId}/notificationJobs/${notificationId}`), { id: notificationId, agencyId: input.agencyId, tenantId: input.tenantId, tenancyId: input.tenancyId, channel: 'email', recipient: input.recipient, subject: input.subject, message: input.message, communicationId, status: 'queued', queuedAt: now, createdBy: 'system:tenant-automation', createdAt: now, updatedAt: now, version: 1 });
    });
  }
  await deliverNotification(input.agencyId, notificationId);
  await eventRef.set({ status: 'completed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
  return true;
}

async function runAgencyAutomation(agencyId: string, now: Date): Promise<number> {
  const database = firestoreDb(adminApp());
  const [tenancySnap, participantSnap, tenantSnap, actionSnap, documentSnap] = await Promise.all([
    database.collection(`agencies/${agencyId}/tenancies`).get(),
    database.collection(`agencies/${agencyId}/tenancyParticipants`).get(),
    database.collection(`agencies/${agencyId}/tenants`).get(),
    database.collection(`agencies/${agencyId}/tenantInstructions`).get(),
    database.collection(`agencies/${agencyId}/tenancyDocuments`).get(),
  ]);
  const tenancies = tenancySnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as TenancyRecord);
  const participants = participantSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ParticipantRecord);
  const tenants = tenantSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as TenantRecord);
  const actions = actionSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string });
  const documents = documentSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string });
  const dateKey = now.toISOString().slice(0, 10);
  let emitted = 0;

  for (const action of actions) {
    const tenancyId = typeof action.tenancyId === 'string' ? action.tenancyId : '';
    if (!tenancyId || ['resolved', 'closed', 'cancelled', 'withdrawn'].includes(String(action.status))) continue;
    const remaining = daysUntil(typeof action.dueDate === 'string' ? action.dueDate : undefined, now);
    if (remaining !== 1 && !(remaining !== undefined && remaining < 0)) continue;
    const rule = remaining === 1 ? 'action_due_tomorrow' : 'action_overdue';
    for (const recipient of await tenancyRecipients(tenancyId, participants, tenants)) {
      const portal = await portalLink(agencyId, recipient.tenantId, tenancyId, recipient.email);
      if (await emitAutomationNotification({ agencyId, dateKey, rule, entityId: action.id, tenantId: recipient.tenantId, tenancyId, recipient: recipient.email, subject: `${remaining === 1 ? 'Action due tomorrow' : 'Action overdue'}: ${String(action.title || 'Tenant action')}`, message: `${remaining === 1 ? 'A tenant action is due tomorrow.' : 'A tenant action is overdue.'} Review and respond securely: ${portal}`, relatedEntityType: 'tenant_instruction' })) emitted += 1;
    }
  }

  for (const document of documents) {
    const tenancyId = typeof document.tenancyId === 'string' ? document.tenancyId : '';
    if (!tenancyId || !['signature_required', 'partially_signed'].includes(String(document.status))) continue;
    const signers = Array.isArray(document.signers) ? document.signers as Array<Record<string, unknown>> : [];
    for (const signer of signers.filter((item) => item.kind === 'tenant' && item.status !== 'signed' && typeof item.tenantId === 'string')) {
      const tenant = tenants.find((item) => item.id === signer.tenantId);
      const recipient = tenant?.email?.trim().toLowerCase();
      if (!tenant || !recipient) continue;
      const portal = await portalLink(agencyId, tenant.id, tenancyId, recipient);
      if (await emitAutomationNotification({ agencyId, dateKey, rule: 'document_signature_required', entityId: document.id, tenantId: tenant.id, tenancyId, recipient, subject: `Signature required: ${String(document.title || 'Tenancy document')}`, message: `A tenancy document is awaiting your signature. Review it securely: ${portal}`, relatedEntityType: 'tenancy_document' })) emitted += 1;
    }
  }

  for (const tenancy of tenancies) {
    if (['ended', 'cancelled'].includes(String(tenancy.lifecycleStatus || tenancy.status))) continue;
    const remaining = daysUntil(tenancy.leaseEndDate, now);
    if (![60, 30, 14].includes(remaining ?? -1)) continue;
    for (const recipient of await tenancyRecipients(tenancy.id, participants, tenants)) {
      if (await emitAutomationNotification({ agencyId, dateKey, rule: `tenancy_expiry_${remaining}`, entityId: tenancy.id, tenantId: recipient.tenantId, tenancyId: tenancy.id, recipient: recipient.email, subject: `Tenancy ends in ${remaining} days`, message: `Your recorded tenancy end date is ${tenancy.leaseEndDate}. Your property manager will contact you if action is required.`, relatedEntityType: 'general' })) emitted += 1;
    }
  }
  return emitted;
}

export async function runTenantAutomation(now = new Date()): Promise<{ agencies: number; emitted: number }> {
  const agencySnapshot = await firestoreDb(adminApp()).collection('agencies').get();
  let emitted = 0;
  for (const agency of agencySnapshot.docs) emitted += await runAgencyAutomation(agency.id, now);
  return { agencies: agencySnapshot.size, emitted };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { status: 'ok', service: 'notification-worker' });
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed.' });
    return;
  }
  try {
    if (url.pathname === '/tasks/notification') {
      const payload = decodePubSub(await readBody(req));
      const agencyId = typeof payload.agencyId === 'string' ? payload.agencyId : '';
      const notificationId = typeof payload.taskId === 'string' ? payload.taskId : typeof payload.id === 'string' ? payload.id : '';
      if (!agencyId || !notificationId) throw new Error('Notification payload requires agencyId and taskId.');
      await deliverNotification(agencyId, notificationId, payload as unknown as NotificationJob);
      json(res, 200, { status: 'delivered', notificationId });
      return;
    }
    if (url.pathname === '/tasks/tenant-automation') {
      const result = await runTenantAutomation();
      json(res, 200, { status: 'completed', ...result });
      return;
    }
    json(res, 404, { error: 'Route not found.' });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'notification-worker.request_failed', error: error instanceof Error ? error.message : String(error) }));
    json(res, Number((error as { status?: unknown })?.status) || 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

const port = Number(process.env.PORT || 8080);
createServer((req, res) => void handle(req, res)).listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'notification-worker.listening', port }));
});
