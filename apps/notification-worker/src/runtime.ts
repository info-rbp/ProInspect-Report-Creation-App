import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import type { CommunicationPolicy, CommunicationTemplate, NotificationRule } from '@pcr/domain';

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

interface EncryptedSecret {
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface NotificationJob {
  id?: string;
  agencyId?: string;
  tenantId?: string;
  tenancyId?: string;
  propertyId?: string;
  inspectionJobId?: string;
  inspectionRequestId?: string;
  channel: 'email' | 'sms' | 'portal';
  recipient: string;
  subject?: string;
  message: string;
  communicationId?: string;
  eventType?: string;
  ruleId?: string;
  templateId?: string;
  status?: string;
  queuedAt?: string;
  notBeforeAt?: string;
  nextAttemptAt?: string;
  escalationDueAt?: string;
  escalationTarget?: string;
  retryCount?: number;
  attempts?: number;
  sentAt?: string;
  deliveredAt?: string;
  providerMessageId?: string;
}

interface TenantRecord {
  id: string;
  email?: string;
  phone?: string;
  fullName?: string;
  firstName?: string;
}

interface TenancyRecord {
  id: string;
  propertyId?: string;
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

interface RecipientContext {
  recipient: string;
  channel: 'email' | 'sms';
  tenantId?: string;
  variables: Record<string, string>;
}

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function database() {
  return getFirestore(adminApp());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function decodeEncryptionKey(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY is required to use agency-managed communication credentials.');
  const value = /^[a-f0-9]{64}$/iu.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (value.length !== 32) throw new Error('INTEGRATION_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return value;
}

function decryptIntegrationSecret<T>(secret: EncryptedSecret, additionalData: string): T {
  if (secret.algorithm !== 'aes-256-gcm') throw new Error('Unsupported integration credential algorithm.');
  const decipher = createDecipheriv('aes-256-gcm', decodeEncryptionKey(), Buffer.from(secret.iv, 'base64'));
  decipher.setAAD(Buffer.from(additionalData, 'utf8'));
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
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

async function globalSecretProviderConfig(): Promise<ProviderConfig> {
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
    if (!body.payload?.data) return {};
    return JSON.parse(Buffer.from(body.payload.data, 'base64').toString('utf8')) as ProviderConfig;
  } catch {
    return {};
  }
}

async function integrationCredentials(agencyId: string, provider: 'sendgrid' | 'twilio'): Promise<Record<string, string>> {
  const snapshot = await database().doc(`agencies/${agencyId}/integrationCredentials/${provider}`).get();
  if (!snapshot.exists) return {};
  const stored = snapshot.data() as { encrypted?: EncryptedSecret };
  if (!stored.encrypted) return {};
  return decryptIntegrationSecret<Record<string, string>>(stored.encrypted, `${agencyId}:${provider}`);
}

async function communicationPolicy(agencyId: string): Promise<CommunicationPolicy | undefined> {
  const snapshot = await database().doc(`agencies/${agencyId}/agencySettings/communications`).get();
  return snapshot.exists ? snapshot.data() as CommunicationPolicy : undefined;
}

const providerCache = new Map<string, { value: ProviderConfig; expiresAt: number }>();
async function providerConfig(agencyId: string): Promise<ProviderConfig> {
  const cached = providerCache.get(agencyId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let global: ProviderConfig = {};
  const raw = process.env.NOTIFICATION_PROVIDER_CONFIG?.trim();
  if (raw) {
    try { global = JSON.parse(raw) as ProviderConfig; }
    catch { console.error(JSON.stringify({ level: 'error', message: 'notification.config.invalid_json' })); }
  } else {
    global = await globalSecretProviderConfig();
  }
  global = {
    ...global,
    sendgridApiKey: process.env.SENDGRID_API_KEY?.trim() || global.sendgridApiKey,
    sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL?.trim() || global.sendgridFromEmail,
    sendgridFromName: process.env.SENDGRID_FROM_NAME?.trim() || global.sendgridFromName,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || global.twilioAccountSid,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim() || global.twilioAuthToken,
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER?.trim() || global.twilioFromNumber,
    callbackBaseUrl: process.env.NOTIFICATION_CALLBACK_BASE_URL?.trim() || global.callbackBaseUrl,
    callbackSecret: process.env.NOTIFICATION_CALLBACK_SECRET?.trim() || global.callbackSecret,
  };

  const policy = await communicationPolicy(agencyId);
  const sendgridSettings = policy?.providers?.find((item) => item.channel === 'email' && item.provider === 'sendgrid' && item.enabled);
  const twilioSettings = policy?.providers?.find((item) => item.channel === 'sms' && item.provider === 'twilio' && item.enabled);
  let sendgrid: Record<string, string> = {};
  let twilio: Record<string, string> = {};
  try { if (sendgridSettings) sendgrid = await integrationCredentials(agencyId, 'sendgrid'); }
  catch (error) { console.error(JSON.stringify({ level: 'error', message: 'notification.sendgrid.credentials_failed', agencyId, error: error instanceof Error ? error.message : String(error) })); }
  try { if (twilioSettings) twilio = await integrationCredentials(agencyId, 'twilio'); }
  catch (error) { console.error(JSON.stringify({ level: 'error', message: 'notification.twilio.credentials_failed', agencyId, error: error instanceof Error ? error.message : String(error) })); }

  const value: ProviderConfig = {
    ...global,
    ...(sendgridSettings ? {
      sendgridApiKey: sendgrid.apiKey || global.sendgridApiKey,
      sendgridFromEmail: sendgridSettings.senderAddress || global.sendgridFromEmail,
      sendgridFromName: sendgridSettings.senderName || global.sendgridFromName,
    } : {}),
    ...(twilioSettings ? {
      twilioAccountSid: twilio.accountSid || global.twilioAccountSid,
      twilioAuthToken: twilio.authToken || global.twilioAuthToken,
      twilioFromNumber: twilioSettings.originatingNumber || global.twilioFromNumber,
    } : {}),
  };
  providerCache.set(agencyId, { value, expiresAt: Date.now() + 5 * 60_000 });
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
  return message.replace(/(^|\s)(\/(?:tenant-portal|report-recipient)\/[A-Za-z0-9%._~-]+)/gu, (_match, prefix: string, path: string) => `${prefix}${base}${path}`);
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((item) => item.type === 'hour')?.value || 0);
  const minute = Number(parts.find((item) => item.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function clockMinutes(value?: string): number | undefined {
  if (!value || !/^\d{2}:\d{2}$/u.test(value)) return undefined;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : undefined;
}

function inQuietHours(policy: CommunicationPolicy | undefined, at = new Date()): boolean {
  const start = clockMinutes(policy?.quietHoursStart);
  const end = clockMinutes(policy?.quietHoursEnd);
  if (start === undefined || end === undefined || start === end) return false;
  const current = localMinutes(at, policy?.timezone || 'Australia/Perth');
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function renderTemplate(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/gu, (_match, key: string) => variables[key] ?? '');
}

async function activeRules(agencyId: string, eventType: string): Promise<Array<{ rule: NotificationRule; template: CommunicationTemplate }>> {
  const [ruleSnapshot, templateSnapshot] = await Promise.all([
    database().collection(`agencies/${agencyId}/notificationRules`).get(),
    database().collection(`agencies/${agencyId}/communicationTemplates`).get(),
  ]);
  const templates = new Map(templateSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() } as CommunicationTemplate]));
  return ruleSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as NotificationRule))
    .filter((rule) => rule.enabled && rule.status !== 'retired' && rule.eventType === eventType)
    .flatMap((rule) => {
      const template = templates.get(rule.templateId);
      return template && template.status !== 'retired' && template.eventType === eventType
        ? [{ rule, template }]
        : [];
    });
}

async function propertyVariables(agencyId: string, propertyId?: string): Promise<Record<string, string>> {
  if (!propertyId) return {};
  const snapshot = await database().doc(`agencies/${agencyId}/properties/${propertyId}`).get();
  if (!snapshot.exists) return {};
  const data = snapshot.data() as Record<string, unknown>;
  const address = text(data.displayAddress) || text(data.formattedAddress) || [data.addressLine1, data.suburb, data.state, data.postcode].map(text).filter(Boolean).join(', ');
  return { 'property.address': address };
}

function dateVariables(prefix: string, value?: string, timezone = 'Australia/Perth'): Record<string, string> {
  if (!value) return {};
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return {};
  return {
    [`${prefix}.startDate`]: new Intl.DateTimeFormat('en-AU', { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed),
    [`${prefix}.startTime`]: new Intl.DateTimeFormat('en-AU', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(parsed),
  };
}

async function inspectionRecipients(agencyId: string, jobId: string): Promise<RecipientContext[]> {
  const jobSnapshot = await database().doc(`agencies/${agencyId}/inspectionJobs/${jobId}`).get();
  if (!jobSnapshot.exists) return [];
  const job = jobSnapshot.data() as Record<string, unknown>;
  const requestId = text(job.inspectionRequestId);
  const requestSnapshot = requestId ? await database().doc(`agencies/${agencyId}/inspectionRequests/${requestId}`).get() : undefined;
  const request = requestSnapshot?.exists ? requestSnapshot.data() as Record<string, unknown> : {};
  const timezone = text(job.timezone) || 'Australia/Perth';
  const baseVariables = {
    ...(await propertyVariables(agencyId, text(job.propertyId))),
    ...dateVariables('inspection', text(job.scheduledAt), timezone),
  };
  const results: RecipientContext[] = [];
  const customerEmail = text(request.customerEmail);
  if (customerEmail) results.push({ recipient: customerEmail.toLowerCase(), channel: 'email', variables: baseVariables });
  const customerPhone = text(request.customerPhone);
  if (customerPhone) results.push({ recipient: customerPhone, channel: 'sms', variables: baseVariables });

  const tenancyId = text(job.tenancyId);
  if (tenancyId) {
    const [participants, tenants] = await Promise.all([
      database().collection(`agencies/${agencyId}/tenancyParticipants`).where('tenancyId', '==', tenancyId).get(),
      database().collection(`agencies/${agencyId}/tenants`).get(),
    ]);
    const tenantMap = new Map(tenants.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() } as TenantRecord]));
    for (const participant of participants.docs) {
      const data = participant.data() as ParticipantRecord;
      if (data.status === 'ended' || !['primary_tenant', 'co_tenant'].includes(String(data.role))) continue;
      const tenant = tenantMap.get(data.tenantId);
      if (!tenant) continue;
      const variables = {
        ...baseVariables,
        'tenant.fullName': tenant.fullName || '',
        'tenant.firstName': tenant.firstName || tenant.fullName?.split(/\s+/u)[0] || '',
      };
      if (tenant.email) results.push({ recipient: tenant.email.toLowerCase(), channel: 'email', tenantId: tenant.id, variables });
      if (tenant.phone) results.push({ recipient: tenant.phone, channel: 'sms', tenantId: tenant.id, variables });
    }
  }
  const unique = new Map(results.map((item) => [`${item.channel}:${item.recipient}`, item]));
  return [...unique.values()];
}

async function queueEvent(
  agencyId: string,
  eventType: string,
  recipients: RecipientContext[],
  defaults: { subject: string; message: string },
  context: Partial<NotificationJob> = {},
): Promise<string[]> {
  const matches = await activeRules(agencyId, eventType);
  const policy = await communicationPolicy(agencyId);
  const now = new Date();
  const ids: string[] = [];

  const effectiveMatches = matches.length
    ? matches
    : [{
        rule: {
          id: `system-${eventType}`,
          eventType,
          channel: 'email',
          templateId: `system-${eventType}`,
          delayMinutes: 0,
          retryCount: 2,
          enabled: true,
          status: 'active',
          agencyId,
        } as NotificationRule,
        template: {
          id: `system-${eventType}`,
          eventType,
          channel: 'email',
          name: eventType,
          subject: defaults.subject,
          body: defaults.message,
          allowedVariables: [],
          status: 'active',
          agencyId,
        } as CommunicationTemplate,
      }];

  for (const { rule, template } of effectiveMatches) {
    for (const recipient of recipients.filter((item) => item.channel === rule.channel)) {
      const id = createHash('sha256')
        .update(`${agencyId}|${eventType}|${rule.id}|${recipient.channel}|${recipient.recipient}|${text(context.communicationId)}|${text(context.inspectionJobId)}|${now.toISOString().slice(0, 10)}`)
        .digest('hex');
      const ref = database().doc(`agencies/${agencyId}/notificationJobs/${id}`);
      const existing = await ref.get();
      if (existing.exists && ['queued', 'sent', 'delivered', 'running'].includes(String(existing.get('status')))) {
        ids.push(id);
        continue;
      }
      const delayedUntil = new Date(now.getTime() + Math.max(0, rule.delayMinutes || 0) * 60_000);
      const quiet = inQuietHours(policy, delayedUntil);
      const notBeforeAt = quiet
        ? new Date(Math.max(delayedUntil.getTime(), now.getTime() + 60 * 60_000)).toISOString()
        : delayedUntil.toISOString();
      const escalationDueAt = rule.escalationAfterMinutes && rule.escalationAfterMinutes > 0
        ? new Date(now.getTime() + rule.escalationAfterMinutes * 60_000).toISOString()
        : undefined;
      const job: NotificationJob = {
        id,
        agencyId,
        channel: rule.channel,
        recipient: recipient.recipient,
        subject: template.subject ? renderTemplate(template.subject, recipient.variables) : defaults.subject,
        message: renderTemplate(template.body || defaults.message, recipient.variables),
        eventType,
        ruleId: rule.id,
        templateId: template.id,
        retryCount: rule.retryCount,
        attempts: 0,
        status: 'queued',
        queuedAt: now.toISOString(),
        notBeforeAt,
        ...(rule.escalationTarget ? { escalationTarget: rule.escalationTarget } : {}),
        ...(escalationDueAt ? { escalationDueAt } : {}),
        ...(recipient.tenantId ? { tenantId: recipient.tenantId } : {}),
        ...context,
      };
      await ref.set(job, { merge: true });
      ids.push(id);
    }
  }
  return ids;
}

async function updateCommunication(agencyId: string, job: NotificationJob, patch: Record<string, unknown>) {
  if (!job.communicationId) return;
  const collection = job.inspectionJobId ? 'inspectionCommunications' : 'tenantCommunications';
  await database().doc(`agencies/${agencyId}/${collection}/${job.communicationId}`).set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}

async function sendEmail(agencyId: string, notificationId: string, job: NotificationJob, provider: ProviderConfig) {
  if (!provider.sendgridApiKey || !provider.sendgridFromEmail) throw new Error('SendGrid email delivery is not configured.');
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
  if (!provider.twilioAccountSid || !provider.twilioAuthToken || !provider.twilioFromNumber) throw new Error('Twilio SMS delivery is not configured.');
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

async function recordEscalation(agencyId: string, notificationId: string, job: NotificationJob, reason: string) {
  if (!job.escalationTarget) return;
  const id = `escalation-${notificationId}`;
  await database().doc(`agencies/${agencyId}/notificationEscalations/${id}`).set({
    id,
    agencyId,
    notificationId,
    eventType: job.eventType,
    target: job.escalationTarget,
    reason,
    status: 'attention_required',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function deliverNotification(agencyId: string, notificationId: string, supplied?: NotificationJob): Promise<NotificationJob> {
  const ref = database().doc(`agencies/${agencyId}/notificationJobs/${notificationId}`);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() as NotificationJob : supplied;
  if (!existing || !existing.channel || !existing.recipient || !existing.message) {
    throw new Error(`Notification job is incomplete: ${notificationId}`);
  }
  if (['sent', 'delivered'].includes(String(existing.status))) return { ...existing, id: notificationId, agencyId };
  const due = existing.nextAttemptAt || existing.notBeforeAt;
  if (due && Date.parse(due) > Date.now()) return { ...existing, id: notificationId, agencyId };
  const policy = await communicationPolicy(agencyId);
  if (inQuietHours(policy)) {
    const notBeforeAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await ref.set({ status: 'queued', notBeforeAt, updatedAt: new Date().toISOString() }, { merge: true });
    return { ...existing, id: notificationId, agencyId, status: 'queued', notBeforeAt };
  }

  const provider = await providerConfig(agencyId);
  const now = new Date().toISOString();
  try {
    await ref.set({ status: 'running', updatedAt: now }, { merge: true });
    let providerMessageId: string | undefined;
    let status: 'sent' | 'delivered' = 'sent';
    if (existing.channel === 'email') providerMessageId = await sendEmail(agencyId, notificationId, existing, provider);
    else if (existing.channel === 'sms') providerMessageId = await sendSms(agencyId, notificationId, existing, provider);
    else status = 'delivered';
    const patch = {
      status,
      sentAt: now,
      ...(status === 'delivered' ? { deliveredAt: now } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
      updatedAt: now,
      lastError: null,
    };
    await ref.set(patch, { merge: true });
    await updateCommunication(agencyId, existing, patch);
    return { ...existing, ...patch, id: notificationId, agencyId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = Number(existing.attempts || 0) + 1;
    const retryCount = Math.max(0, Number(existing.retryCount || 0));
    const retryable = attempts <= retryCount;
    const nextAttemptAt = retryable
      ? new Date(Date.now() + Math.min(60, 5 * 2 ** Math.max(0, attempts - 1)) * 60_000).toISOString()
      : undefined;
    const patch = {
      status: retryable ? 'queued' : 'failed',
      lastError: message,
      attempts,
      ...(nextAttemptAt ? { nextAttemptAt } : {}),
      updatedAt: now,
    };
    await ref.set(patch, { merge: true });
    await updateCommunication(agencyId, existing, patch);
    if (!retryable || (existing.escalationDueAt && Date.parse(existing.escalationDueAt) <= Date.now())) {
      await recordEscalation(agencyId, notificationId, existing, message);
    }
    if (!retryable) throw error;
    return { ...existing, ...patch, id: notificationId, agencyId };
  }
}

async function processEventPayload(agencyId: string, payload: Record<string, unknown>): Promise<string[]> {
  const eventType = text(payload.eventType) || text(payload.type);
  if (!eventType) return [];
  if (eventType === 'inspection_reminder') {
    const jobId = text(payload.inspectionJobId);
    if (!jobId) throw new Error('inspection_reminder requires inspectionJobId.');
    const recipients = await inspectionRecipients(agencyId, jobId);
    return queueEvent(
      agencyId,
      eventType,
      recipients,
      {
        subject: 'Upcoming property inspection reminder',
        message: 'Reminder: your property inspection at {{property.address}} is scheduled for {{inspection.startDate}} at {{inspection.startTime}}.',
      },
      { inspectionJobId: jobId, communicationId: text(payload.communicationId) || undefined },
    );
  }
  if (text(payload.recipient) && text(payload.message)) {
    const channel = payload.channel === 'sms' ? 'sms' : 'email';
    return queueEvent(
      agencyId,
      eventType,
      [{ recipient: text(payload.recipient), channel, variables: asRecord(payload.variables) as Record<string, string> }],
      { subject: text(payload.subject) || 'ProInspect notification', message: text(payload.message) },
      { communicationId: text(payload.communicationId) || undefined },
    );
  }
  return [];
}

function daysUntil(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.ceil((time - now.getTime()) / 86_400_000) : undefined;
}

async function tenancyRecipients(agencyId: string, tenancyId: string): Promise<Array<{ tenant: TenantRecord; email: string }>> {
  const [participantSnap, tenantSnap] = await Promise.all([
    database().collection(`agencies/${agencyId}/tenancyParticipants`).where('tenancyId', '==', tenancyId).get(),
    database().collection(`agencies/${agencyId}/tenants`).get(),
  ]);
  const tenants = new Map(tenantSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() } as TenantRecord]));
  return participantSnap.docs.flatMap((doc) => {
    const participant = doc.data() as ParticipantRecord;
    const tenant = tenants.get(participant.tenantId);
    if (!tenant?.email || participant.status === 'ended' || !['primary_tenant', 'co_tenant'].includes(String(participant.role))) return [];
    return [{ tenant, email: tenant.email.trim().toLowerCase() }];
  });
}

async function portalLink(agencyId: string, tenantId: string, tenancyId: string, recipientEmail: string): Promise<string> {
  const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
  const grantId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
  await database().doc(`agencies/${agencyId}/tenantPortalGrants/${grantId}`).create({
    id: grantId,
    agencyId,
    tenantId,
    tenancyId,
    recipientEmail,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt,
    createdBy: 'system:tenant-automation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  });
  return `${webBaseUrl()}/tenant-portal/${rawToken}`;
}

async function queueTenantEvent(input: {
  agencyId: string;
  eventType: string;
  entityId: string;
  tenancyId: string;
  subject: string;
  message: string;
  propertyId?: string;
}): Promise<number> {
  let queued = 0;
  for (const { tenant, email } of await tenancyRecipients(input.agencyId, input.tenancyId)) {
    const portal = await portalLink(input.agencyId, tenant.id, input.tenancyId, email);
    const variables = {
      'tenant.fullName': tenant.fullName || '',
      'tenant.firstName': tenant.firstName || tenant.fullName?.split(/\s+/u)[0] || '',
      'report.accessUrl': portal,
      'approval.accessUrl': portal,
      ...(await propertyVariables(input.agencyId, input.propertyId)),
    };
    const ids = await queueEvent(
      input.agencyId,
      input.eventType,
      [{ recipient: email, channel: 'email', tenantId: tenant.id, variables }],
      { subject: input.subject, message: `${input.message} ${portal}` },
      { tenantId: tenant.id, tenancyId: input.tenancyId, eventType: input.eventType },
    );
    queued += ids.length;
  }
  return queued;
}

async function runAgencyAutomation(agencyId: string, now: Date): Promise<{ queued: number; delivered: number }> {
  const [tenancySnap, actionSnap, documentSnap, queuedSnap] = await Promise.all([
    database().collection(`agencies/${agencyId}/tenancies`).get(),
    database().collection(`agencies/${agencyId}/tenantInstructions`).get(),
    database().collection(`agencies/${agencyId}/tenancyDocuments`).get(),
    database().collection(`agencies/${agencyId}/notificationJobs`).where('status', 'in', ['queued', 'failed']).limit(250).get(),
  ]);
  let queued = 0;
  let delivered = 0;
  const dateKey = now.toISOString().slice(0, 10);

  for (const actionDoc of actionSnap.docs) {
    const action = { id: actionDoc.id, ...actionDoc.data() } as Record<string, unknown> & { id: string };
    const tenancyId = text(action.tenancyId);
    if (!tenancyId || ['resolved', 'closed', 'cancelled', 'withdrawn'].includes(text(action.status))) continue;
    const remaining = daysUntil(text(action.dueDate) || undefined, now);
    if (remaining !== 1 && !(remaining !== undefined && remaining < 0)) continue;
    const eventType = remaining === 1 ? 'action_due_tomorrow' : 'action_overdue';
    const marker = database().doc(`agencies/${agencyId}/tenantAutomationEvents/${createHash('sha256').update(`${eventType}:${action.id}:${dateKey}`).digest('hex')}`);
    if ((await marker.get()).exists) continue;
    const tenancy = tenancySnap.docs.find((doc) => doc.id === tenancyId)?.data() as TenancyRecord | undefined;
    const count = await queueTenantEvent({ agencyId, eventType, entityId: action.id, tenancyId, subject: `${remaining === 1 ? 'Action due tomorrow' : 'Action overdue'}: ${text(action.title) || 'Tenant action'}`, message: remaining === 1 ? 'A tenant action is due tomorrow.' : 'A tenant action is overdue.', propertyId: tenancy?.propertyId });
    await marker.set({ eventType, entityId: action.id, dateKey, queued: count, createdAt: new Date().toISOString() });
    queued += count;
  }

  for (const documentDoc of documentSnap.docs) {
    const document = { id: documentDoc.id, ...documentDoc.data() } as Record<string, unknown> & { id: string };
    const tenancyId = text(document.tenancyId);
    if (!tenancyId || !['signature_required', 'partially_signed'].includes(text(document.status))) continue;
    const marker = database().doc(`agencies/${agencyId}/tenantAutomationEvents/${createHash('sha256').update(`document_signature_required:${document.id}:${dateKey}`).digest('hex')}`);
    if ((await marker.get()).exists) continue;
    const tenancy = tenancySnap.docs.find((doc) => doc.id === tenancyId)?.data() as TenancyRecord | undefined;
    const count = await queueTenantEvent({ agencyId, eventType: 'document_signature_required', entityId: document.id, tenancyId, subject: `Signature required: ${text(document.title) || 'Tenancy document'}`, message: 'A tenancy document is awaiting your signature. Review it securely:', propertyId: tenancy?.propertyId });
    await marker.set({ eventType: 'document_signature_required', entityId: document.id, dateKey, queued: count, createdAt: new Date().toISOString() });
    queued += count;
  }

  for (const tenancyDoc of tenancySnap.docs) {
    const tenancy = { id: tenancyDoc.id, ...tenancyDoc.data() } as TenancyRecord;
    if (['ended', 'cancelled'].includes(String(tenancy.lifecycleStatus || tenancy.status))) continue;
    const remaining = daysUntil(tenancy.leaseEndDate, now);
    if (![60, 30, 14].includes(remaining ?? -1)) continue;
    const eventType = `tenancy_expiry_${remaining}`;
    const marker = database().doc(`agencies/${agencyId}/tenantAutomationEvents/${createHash('sha256').update(`${eventType}:${tenancy.id}:${dateKey}`).digest('hex')}`);
    if ((await marker.get()).exists) continue;
    const count = await queueTenantEvent({ agencyId, eventType, entityId: tenancy.id, tenancyId: tenancy.id, subject: `Tenancy ends in ${remaining} days`, message: `Your recorded tenancy end date is ${tenancy.leaseEndDate}. Your property manager will contact you if action is required.`, propertyId: tenancy.propertyId });
    await marker.set({ eventType, entityId: tenancy.id, dateKey, queued: count, createdAt: new Date().toISOString() });
    queued += count;
  }

  for (const queuedDocument of queuedSnap.docs) {
    const job = { id: queuedDocument.id, ...queuedDocument.data() } as NotificationJob;
    const due = job.nextAttemptAt || job.notBeforeAt;
    if (due && Date.parse(due) > now.getTime()) continue;
    try {
      const result = await deliverNotification(agencyId, queuedDocument.id, job);
      if (result.status === 'sent' || result.status === 'delivered') delivered += 1;
    } catch {
      // The job records its terminal failure and optional escalation. Continue draining the queue.
    }
  }
  return { queued, delivered };
}

export async function runTenantAutomation(now = new Date()): Promise<{ agencies: number; queued: number; delivered: number }> {
  const agencySnapshot = await database().collection('agencies').get();
  let queued = 0;
  let delivered = 0;
  for (const agency of agencySnapshot.docs) {
    const result = await runAgencyAutomation(agency.id, now);
    queued += result.queued;
    delivered += result.delivered;
  }
  return { agencies: agencySnapshot.size, queued, delivered };
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

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { status: 'ok', service: 'notification-worker', runtime: 'settings-authoritative-v2' });
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed.' });
    return;
  }
  try {
    if (url.pathname === '/tasks/notification') {
      const payload = decodePubSub(await readBody(req));
      const agencyId = text(payload.agencyId);
      const taskId = text(payload.taskId) || text(payload.id);
      if (!agencyId || !taskId) throw new Error('Notification payload requires agencyId and taskId.');
      const stored = await database().doc(`agencies/${agencyId}/notificationJobs/${taskId}`).get();
      if (stored.exists) {
        await deliverNotification(agencyId, taskId, stored.data() as NotificationJob);
        json(res, 200, { status: 'processed', notificationIds: [taskId] });
        return;
      }
      const materialized = await processEventPayload(agencyId, payload);
      for (const id of materialized) await deliverNotification(agencyId, id);
      if (!materialized.length) throw new Error(`No notification job or supported notification event exists for ${taskId}.`);
      json(res, 200, { status: 'processed', notificationIds: materialized });
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
  console.log(JSON.stringify({ level: 'info', message: 'notification-worker.listening', port, runtime: 'settings-authoritative-v2' }));
});
