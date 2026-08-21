import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  KeyRound,
  MessageSquareText,
  RefreshCw,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import type {
  InspectionAccessStatus,
  InspectionCommunication,
  InspectionJob,
  InspectionReadinessResult,
} from '../../types/platform';
import { getInspectionJob } from '../../services/platform/inspectionJobService';
import {
  createInspectionCommunication,
  getInspectionJobReadiness,
  listInspectionCommunications,
  rescheduleInspectionJob,
  syncInspectionJobCalendar,
  updateInspectionAccessStatus,
} from '../../services/platform/inspectionOperationsService';

function badge(value?: string): string {
  if (['paid', 'booked', 'matched', 'confirmed', 'synchronised', 'not_required'].includes(value || '')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (['failed', 'cancelled', 'refunded', 'unable_to_access', 'overdue'].includes(value || '')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function label(value?: string): string {
  return value ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()) : 'Not set';
}

const Pill: React.FC<{ value?: string }> = ({ value }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${badge(value)}`}>
    {label(value)}
  </span>
);

export const InspectionJobOperationsPanel: React.FC<{ jobId: string }> = ({ jobId }) => {
  const [job, setJob] = useState<InspectionJob | null>(null);
  const [readiness, setReadiness] = useState<InspectionReadinessResult | null>(null);
  const [communications, setCommunications] = useState<InspectionCommunication[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [communication, setCommunication] = useState('');

  const load = async () => {
    const next = await getInspectionJob(jobId);
    setJob(next || null);
    if (!next) return;
    const [nextReadiness, nextCommunications] = await Promise.all([
      getInspectionJobReadiness(next),
      listInspectionCommunications(next.id),
    ]);
    setReadiness(nextReadiness);
    setCommunications(nextCommunications.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
    setRescheduleAt(next.scheduledAt ? new Date(new Date(next.scheduledAt).getTime() - new Date(next.scheduledAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
  };

  useEffect(() => {
    void load().catch((failure) => setError(failure instanceof Error ? failure.message : 'Operational details could not be loaded.'));
  }, [jobId]);

  if (!job) return null;

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Inspection operation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><span>{error}</span><button onClick={() => setError(null)}><XCircle size={15} /></button></div>}

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><ShoppingBag size={17} /><h2 className="font-bold">Order & Intake</h2></div>
          <div className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">Source</span><Pill value={job.source || 'manual'} /></div>
            <div className="flex justify-between"><span className="text-slate-500">Payment</span><Pill value={job.paymentStatus || 'not_required'} /></div>
            <div className="flex justify-between"><span className="text-slate-500">Booking</span><Pill value={job.bookingStatus || (job.scheduledAt ? 'booked' : 'awaiting_booking')} /></div>
            <div className="flex justify-between"><span className="text-slate-500">Property match</span><Pill value={job.propertyMatchStatus || 'matched'} /></div>
            <div className="border-t border-slate-100 pt-3"><b>External reference</b><div className="mt-1 text-slate-500">{job.shopifyOrder?.orderNumber || job.googleCalendar?.eventId || job.inspectionRequestId || 'Manual job'}</div></div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><CalendarDays size={17} /><h2 className="font-bold">Booking & Calendar</h2></div>
          <div className="mt-4 space-y-3 text-xs">
            <div><b>Scheduled</b><div className="mt-1 text-slate-500">{job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : 'Not scheduled'}</div></div>
            <div className="flex gap-2"><input type="datetime-local" value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5" /><button disabled={busy || !rescheduleAt} onClick={() => void run(() => rescheduleInspectionJob(job, { startAt: new Date(rescheduleAt).toISOString(), durationMinutes: job.durationMinutes || 60, timezone: job.timezone || 'Australia/Perth', reason: 'Rescheduled from job console.' }))} className="rounded-lg border border-slate-200 px-3 font-semibold">Reschedule</button></div>
            <button disabled={busy || !job.scheduledAt} onClick={() => void run(() => syncInspectionJobCalendar(job))} className="w-full rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">{job.googleCalendar ? 'Update Google Calendar Event' : 'Create Google Calendar Event'}</button>
            {job.googleCalendar?.htmlLink && <a href={job.googleCalendar.htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-600"><CalendarDays size={12} /> Open Google event</a>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><KeyRound size={17} /><h2 className="font-bold">Access Readiness</h2></div>
          <div className="mt-4 space-y-3">
            <Pill value={job.accessStatus || 'unknown'} />
            <select value={job.accessStatus || 'unknown'} onChange={(event) => void run(() => updateInspectionAccessStatus(job, event.target.value as InspectionAccessStatus))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="unknown">Unknown</option><option value="instructions_available">Instructions available</option><option value="confirmation_requested">Confirmation requested</option><option value="confirmed">Confirmed</option><option value="not_required">Not required</option><option value="unable_to_access">Unable to access</option></select>
            <p className="text-xs text-slate-500">{job.propertySnapshot?.accessInstructions || 'No structured access instructions were captured when the job was created.'}</p>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><CheckCircle2 size={17} /><h2 className="font-bold">Pre-Inspection Readiness</h2></div><span className={`text-xs font-bold ${readiness?.readyForFieldWork ? 'text-emerald-600' : 'text-amber-700'}`}>{readiness?.readyForFieldWork ? 'Ready for field work' : `${readiness?.blockers.length || 0} item(s) require attention`}</span></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{readiness && Object.entries(readiness.gates).map(([gate, passed]) => <div key={gate} className={`rounded-xl border p-3 text-xs ${passed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><div className="flex items-center gap-2 font-semibold">{passed ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{label(gate)}</div></div>)}</div>
        {readiness?.blockers.length ? <div className="mt-4 space-y-2">{readiness.blockers.map((blocker) => <div key={`${blocker.gate}-${blocker.code}`} className="rounded-lg bg-slate-50 p-2.5 text-xs"><b>{blocker.message}</b><div className="text-slate-500">{blocker.code}</div></div>)}</div> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><MessageSquareText size={17} /><h2 className="font-bold">Communications</h2></div>
        <div className="mt-4 flex gap-2"><input value={communication} onChange={(event) => setCommunication(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Record a phone call, email, access confirmation or reminder..." /><button disabled={busy || !communication.trim()} onClick={() => void run(async () => { await createInspectionCommunication(job, { type: 'general', channel: 'system', summary: communication.trim() }); setCommunication(''); })} className="rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white">Record</button></div>
        <div className="mt-4 space-y-2">{communications.slice(0, 10).map((item) => <div key={item.id} className="flex items-start justify-between rounded-xl border border-slate-200 p-3 text-xs"><div><b>{label(item.type)}</b><div className="mt-1 text-slate-500">{item.summary}</div></div><div className="text-right text-[10px] text-slate-400">{new Date(item.occurredAt).toLocaleString()}<div><Pill value={item.status} /></div></div></div>)}</div>
      </section>
    </div>
  );
};

export default InspectionJobOperationsPanel;
