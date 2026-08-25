import React, { useEffect, useMemo, useState } from 'react';
import type { InspectionRoutePlan, InspectionRouteStop } from '@pcr/domain';
import type { InspectionJob, PropertyRecord, UserProfile } from '../../types/platform';
import { createRoutePlan, listRoutePlans, optimiseRoutePlan, publishRoutePlan } from '../../services/platform/enhancementService';
import { listInspectionJobs } from '../../services/platform/inspectionJobService';
import { listProperties } from '../../services/platform/propertyService';
import { listAvailableInspectors } from '../../services/platform/userDirectoryService';

function inspectorLabel(user: UserProfile): string {
  return user.displayName?.trim() || user.email || user.id;
}

function perthSchedule(serviceDate: string, startTime: string, offsetMinutes: number): string {
  const base = new Date(`${serviceDate}T${startTime}:00+08:00`);
  if (Number.isNaN(base.getTime())) throw new Error('The route start time is invalid.');
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString();
}

const InspectionPlannerPage: React.FC = () => {
  const [plans, setPlans] = useState<InspectionRoutePlan[]>([]);
  const [jobs, setJobs] = useState<InspectionJob[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [inspectors, setInspectors] = useState<UserProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [inspectorId, setInspectorId] = useState('');
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextPlans, nextJobs, nextProperties, nextInspectors] = await Promise.all([
        listRoutePlans(),
        listInspectionJobs(),
        listProperties(),
        listAvailableInspectors(),
      ]);
      setPlans(nextPlans);
      setJobs(nextJobs);
      setProperties(nextProperties);
      setInspectors(nextInspectors);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const propertyMap = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const inspectorMap = useMemo(() => new Map(inspectors.map((user) => [user.id, user])), [inspectors]);
  const eligibleJobs = useMemo(() => jobs.filter((job) => !['finalised', 'archived', 'cancelled'].includes(job.status)), [jobs]);

  const toggleJob = (jobId: string) => {
    setSelectedJobs((current) => current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]);
  };

  const openCreate = () => {
    setServiceDate(new Date().toISOString().slice(0, 10));
    setStartTime('09:00');
    setInspectorId('');
    setSelectedJobs([]);
    setError('');
    setShowCreate(true);
  };

  const create = async () => {
    if (!serviceDate) return setError('Choose a service date before creating the route plan.');
    if (!startTime) return setError('Choose a start time before creating the route plan.');
    if (!inspectorId) return setError('Choose an inspector before creating the route plan.');
    if (!selectedJobs.length) return setError('Select at least one inspection job for the route plan.');
    setBusy(true);
    setError('');
    try {
      let offsetMinutes = 0;
      const stops: InspectionRouteStop[] = selectedJobs.map((jobId, index) => {
        const job = jobs.find((candidate) => candidate.id === jobId);
        if (!job) throw new Error(`Inspection job ${jobId} could not be found.`);
        const property = propertyMap.get(job.propertyId);
        if (!property) throw new Error(`The property for inspection job ${jobId} could not be found.`);
        const durationMinutes = job.durationMinutes || 60;
        const scheduledStartAt = job.scheduledAt || perthSchedule(serviceDate, startTime, offsetMinutes);
        const scheduledEndAt = job.scheduledEndAt || new Date(new Date(scheduledStartAt).getTime() + durationMinutes * 60_000).toISOString();
        offsetMinutes = Math.max(offsetMinutes + durationMinutes + 15, Math.round((new Date(scheduledEndAt).getTime() - new Date(perthSchedule(serviceDate, startTime, 0)).getTime()) / 60_000) + 15);
        return {
          id: `stop-${index + 1}-${job.id}`,
          inspectionJobId: job.id,
          propertyId: property.id,
          address: [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', '),
          durationMinutes,
          scheduledStartAt,
          scheduledEndAt,
        };
      });
      await createRoutePlan({ inspectorId, serviceDate, timezone: 'Australia/Perth', status: 'draft', stops, travel: [] });
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (plan: InspectionRoutePlan, action: 'optimise' | 'publish') => {
    setBusy(true);
    setError('');
    try {
      if (action === 'optimise') await optimiseRoutePlan(plan);
      else await publishRoutePlan(plan);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Inspection Planner</h1><p className="text-sm text-gray-600">Build, schedule, optimise and publish inspector routes without changing the inspection evidence workflow.</p></div>
        <button className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={openCreate}>New route plan</button>
      </header>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {loading && <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading inspection plans…</div>}

      {!loading && !plans.length && <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold">No route plans yet</div><p className="mt-1 text-sm text-gray-500">Create a plan only when you have a date, inspector and at least one inspection job ready to schedule.</p></div>}

      <div className="grid gap-3">
        {plans.map((plan) => <article key={plan.id} className="rounded-xl border border-gray-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold">{plan.serviceDate} · {inspectorMap.get(plan.inspectorId) ? inspectorLabel(inspectorMap.get(plan.inspectorId)!) : plan.inspectorId || 'Inspector not assigned'}</div><div className="text-sm text-gray-500">{plan.stops.length} stops · {plan.status} · {Math.round((plan.totalDistanceMetres || 0) / 1000)} km</div></div><div className="flex gap-2"><button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" onClick={() => void act(plan, 'optimise')} disabled={busy || plan.stops.length < 2}>Optimise</button><button className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white disabled:opacity-40" onClick={() => void act(plan, 'publish')} disabled={busy || plan.status === 'published' || !plan.inspectorId || !plan.stops.length}>Publish</button></div></div><ol className="mt-3 grid gap-2">{plan.stops.map((stop, index) => <li key={stop.id} className="rounded bg-gray-50 px-3 py-2 text-sm"><strong>{index + 1}. {stop.address}</strong><span className="ml-2 text-gray-500">{stop.scheduledStartAt ? new Date(stop.scheduledStartAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: plan.timezone }) : 'Unscheduled'}{stop.scheduledEndAt ? `–${new Date(stop.scheduledEndAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: plan.timezone })}` : ''}</span></li>)}</ol></article>)}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="route-plan-title">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="route-plan-title" className="text-lg font-bold">Create route plan</h2><p className="text-sm text-gray-500">Nothing is persisted until you select Create plan. Unscheduled jobs are placed sequentially from the selected start time with a 15-minute travel allowance.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded border px-3 py-1.5 text-sm">Cancel</button></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <label className="text-sm font-medium">Service date<input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm font-medium">Start time<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm font-medium">Inspector<select value={inspectorId} onChange={(event) => setInspectorId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Select inspector</option>{inspectors.map((user) => <option key={user.id} value={user.id}>{inspectorLabel(user)}</option>)}</select></label>
            </div>
            <fieldset className="mt-5"><legend className="text-sm font-semibold">Inspection jobs</legend><div className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded-xl border p-2">{eligibleJobs.length ? eligibleJobs.map((job) => { const property = propertyMap.get(job.propertyId); return <label key={job.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-gray-50"><input type="checkbox" checked={selectedJobs.includes(job.id)} onChange={() => toggleJob(job.id)} className="mt-1" /><span><span className="block text-sm font-semibold">{property?.address || job.propertyId}</span><span className="text-xs text-gray-500">{job.reportType} · {job.status}{job.scheduledAt ? ` · ${new Date(job.scheduledAt).toLocaleString('en-AU')}` : ' · Unscheduled'}</span></span></label>; }) : <div className="p-4 text-center text-sm text-gray-500">No active inspection jobs are available.</div>}</div></fieldset>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={busy || !serviceDate || !startTime || !inspectorId || !selectedJobs.length} onClick={() => void create()} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Creating…' : 'Create plan'}</button></div>
          </div>
        </div>
      )}
    </section>
  );
};
export default InspectionPlannerPage;
