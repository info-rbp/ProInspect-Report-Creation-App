import React, { useEffect, useState } from 'react';
import { Clock3, Mail, MessageSquareText, Plus, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { CommunicationPolicy, CommunicationTemplate, NotificationRule } from '../../../types/platform';
import { apiRequest } from '../../../services/apiClient';
import {
  getCommunicationPolicy,
  saveCommunicationPolicy,
} from '../../../services/platform/agencySettingsService';

const field = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm';
const VARIABLES = [
  'tenant.firstName',
  'tenant.fullName',
  'property.address',
  'inspection.startDate',
  'inspection.startTime',
  'report.accessUrl',
  'maintenance.title',
  'approval.accessUrl',
];

const CommunicationSettingsPanel: React.FC = () => {
  const { userProfile } = useAuth();
  const agencyId = userProfile?.agencyId;
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [policy, setPolicy] = useState<CommunicationPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('Inspection booking confirmation');
  const [eventType, setEventType] = useState('inspection.booked');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [subject, setSubject] = useState('Your inspection booking');
  const [body, setBody] = useState(
    'Hello {{tenant.firstName}}, your inspection at {{property.address}} is booked for {{inspection.startDate}}.',
  );
  const [ruleTemplate, setRuleTemplate] = useState('');
  const [delay, setDelay] = useState(0);
  const [retryCount, setRetryCount] = useState(2);
  const [escalationAfterMinutes, setEscalationAfterMinutes] = useState<number | ''>('');
  const [escalationTarget, setEscalationTarget] = useState('');
  const [quietHoursStart, setQuietHoursStart] = useState('');
  const [quietHoursEnd, setQuietHoursEnd] = useState('');
  const [timezone, setTimezone] = useState('Australia/Perth');

  const load = async () => {
    if (!agencyId) return;
    const [nextTemplates, nextRules, nextPolicy] = await Promise.all([
      apiRequest<CommunicationTemplate[]>(agencyId, '/api/v1/settings/communications/templates'),
      apiRequest<NotificationRule[]>(agencyId, '/api/v1/settings/communications/rules'),
      getCommunicationPolicy(agencyId),
    ]);
    setTemplates(nextTemplates);
    setRules(nextRules);
    setPolicy(nextPolicy);
    if (!ruleTemplate && nextTemplates[0]) setRuleTemplate(nextTemplates[0].id);
    if (nextPolicy) {
      setQuietHoursStart(nextPolicy.quietHoursStart || '');
      setQuietHoursEnd(nextPolicy.quietHoursEnd || '');
      setTimezone(nextPolicy.timezone || 'Australia/Perth');
    }
  };

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : 'Communication settings could not be loaded.'),
    );
  }, [agencyId]);

  const savePolicy = async () => {
    if (!agencyId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const current = policy || ({ status: 'active', providers: [] } as CommunicationPolicy);
      const updated = await saveCommunicationPolicy(agencyId, {
        ...current,
        status: current.status === 'retired' ? 'active' : current.status,
        providers: current.providers || [],
        quietHoursStart: quietHoursStart || undefined,
        quietHoursEnd: quietHoursEnd || undefined,
        timezone: timezone || 'Australia/Perth',
      });
      setPolicy(updated);
      setNotice('Communication policy saved. Quiet hours are enforced by the delivery worker.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Communication policy could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const addTemplate = async () => {
    if (!agencyId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(agencyId, '/api/v1/settings/communications/templates', {
        method: 'POST',
        body: {
          name,
          eventType,
          channel,
          subject: channel === 'email' ? subject : undefined,
          body,
          allowedVariables: VARIABLES,
          status: 'active',
        },
      });
      setNotice('Communication template created.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Template could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const addRule = async () => {
    if (!agencyId || !ruleTemplate) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const template = templates.find((item) => item.id === ruleTemplate);
      await apiRequest(agencyId, '/api/v1/settings/communications/rules', {
        method: 'POST',
        body: {
          eventType: template?.eventType || eventType,
          channel: template?.channel || channel,
          templateId: ruleTemplate,
          delayMinutes: delay,
          retryCount,
          ...(escalationAfterMinutes !== '' ? { escalationAfterMinutes } : {}),
          ...(escalationTarget.trim() ? { escalationTarget: escalationTarget.trim() } : {}),
          enabled: true,
          status: 'active',
        },
      });
      setNotice('Notification rule created and will be evaluated by the delivery worker.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Notification rule could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderCard agencyId={agencyId} provider="sendgrid" label="SendGrid Email" icon={<Mail size={18} />} />
        <ProviderCard agencyId={agencyId} provider="twilio" label="Twilio SMS" icon={<MessageSquareText size={18} />} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock3 size={17} />
            <div>
              <h2 className="font-bold">Delivery policy</h2>
              <p className="text-xs text-slate-500">Quiet hours defer outbound delivery without losing queued notifications.</p>
            </div>
          </div>
          <button
            disabled={busy}
            onClick={() => void savePolicy()}
            className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Save delivery policy
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-semibold">
            Quiet hours start
            <input className={field} type="time" value={quietHoursStart} onChange={(event) => setQuietHoursStart(event.target.value)} />
          </label>
          <label className="text-xs font-semibold">
            Quiet hours end
            <input className={field} type="time" value={quietHoursEnd} onChange={(event) => setQuietHoursEnd(event.target.value)} />
          </label>
          <label className="text-xs font-semibold">
            Timezone
            <input className={field} value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Save size={17} />
          <h2 className="font-bold">Communication templates</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input className={field} value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" />
          <input className={field} value={eventType} onChange={(event) => setEventType(event.target.value)} placeholder="Event type" />
          <select className={field} value={channel} onChange={(event) => setChannel(event.target.value as 'email' | 'sms')}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
          {channel === 'email' && (
            <input className={field} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" />
          )}
          <textarea className={`${field} md:col-span-2`} rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
          <button
            disabled={busy || !name.trim() || !eventType.trim() || !body.trim()}
            onClick={() => void addTemplate()}
            className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            <Plus size={14} />Create template
          </button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {templates.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex justify-between gap-2">
                <b className="text-sm">{item.name}</b>
                <span className="text-[10px] font-bold uppercase text-slate-400">{item.channel}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{item.eventType} · v{item.version || 1}</div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-600">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-bold">Notification rules</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <select className={field} value={ruleTemplate} onChange={(event) => setRuleTemplate(event.target.value)}>
            <option value="">Select template</option>
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <input className={field} type="number" min={0} value={delay} onChange={(event) => setDelay(Number(event.target.value) || 0)} placeholder="Delay minutes" />
          <input className={field} type="number" min={0} max={10} value={retryCount} onChange={(event) => setRetryCount(Math.max(0, Math.min(10, Number(event.target.value) || 0)))} placeholder="Retries" />
          <input className={field} type="number" min={0} value={escalationAfterMinutes} onChange={(event) => setEscalationAfterMinutes(event.target.value ? Number(event.target.value) : '')} placeholder="Escalate after min" />
          <input className={field} value={escalationTarget} onChange={(event) => setEscalationTarget(event.target.value)} placeholder="Escalation target" />
          <button
            disabled={busy || !ruleTemplate}
            onClick={() => void addRule()}
            className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 xl:col-span-5"
          >
            Add rule
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-xs">
              <div>
                <b>{rule.eventType}</b>
                <span className="ml-2 text-slate-500">
                  {rule.delayMinutes} min delay · {rule.retryCount} retries
                  {rule.escalationAfterMinutes ? ` · escalate after ${rule.escalationAfterMinutes} min` : ''}
                </span>
              </div>
              <span className={rule.enabled ? 'text-emerald-700' : 'text-slate-400'}>{rule.enabled ? 'Active' : 'Disabled'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const ProviderCard: React.FC<{
  agencyId?: string;
  provider: 'sendgrid' | 'twilio';
  label: string;
  icon: React.ReactNode;
}> = ({ agencyId, provider, label, icon }) => {
  const [configured, setConfigured] = useState(false);
  const [secret, setSecret] = useState('');
  const [account, setAccount] = useState('');
  const [sender, setSender] = useState('');
  const [senderName, setSenderName] = useState('ProInspect');
  const [replyTo, setReplyTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId) return;
    void apiRequest<Record<string, unknown> | null>(agencyId, `/api/v1/settings/communications/providers/${provider}`)
      .then((value) => {
        setConfigured(Boolean(value));
        const settings = value?.providerSettings as Record<string, unknown> | undefined;
        if (provider === 'sendgrid') {
          setSender(typeof settings?.senderAddress === 'string' ? settings.senderAddress : '');
          setSenderName(typeof settings?.senderName === 'string' ? settings.senderName : 'ProInspect');
          setReplyTo(typeof settings?.replyToAddress === 'string' ? settings.replyToAddress : '');
        } else {
          setSender(typeof settings?.originatingNumber === 'string' ? settings.originatingNumber : '');
        }
      })
      .catch(() => setConfigured(false));
  }, [agencyId, provider]);

  const connect = async () => {
    if (!agencyId || !secret.trim() || !sender.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const requestBody = provider === 'sendgrid'
        ? {
            apiKey: secret,
            accountLabel: account || 'SendGrid',
            senderAddress: sender,
            senderName: senderName || 'ProInspect',
            ...(replyTo.trim() ? { replyToAddress: replyTo.trim() } : {}),
          }
        : {
            accountSid: account,
            authToken: secret,
            accountLabel: account || 'Twilio',
            originatingNumber: sender,
          };
      await apiRequest(agencyId, `/api/v1/settings/communications/providers/${provider}`, {
        method: 'POST',
        body: requestBody,
      });
      setConfigured(true);
      setSecret('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Provider configuration could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold">{icon}{label}</div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      {error && <div className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}
      <div className="mt-4 grid gap-2">
        <input
          className={field}
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          placeholder={provider === 'twilio' ? 'Account SID' : 'Account label'}
        />
        {provider === 'sendgrid' && (
          <input className={field} value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder="Sender name" />
        )}
        <input
          className={field}
          value={sender}
          onChange={(event) => setSender(event.target.value)}
          placeholder={provider === 'sendgrid' ? 'Verified sender email' : 'Twilio originating number'}
        />
        {provider === 'sendgrid' && (
          <input className={field} value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="Reply-to email (optional)" />
        )}
        <input
          className={field}
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={provider === 'sendgrid' ? 'API key' : 'Auth token'}
        />
        <button
          disabled={busy || !secret.trim() || !sender.trim() || (provider === 'twilio' && !account.trim())}
          onClick={() => void connect()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"
        >
          <ShieldCheck size={13} />{busy ? 'Saving…' : configured ? 'Rotate / update' : 'Connect'}
        </button>
      </div>
    </section>
  );
};

export default CommunicationSettingsPanel;
