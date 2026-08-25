import React, { useEffect, useMemo, useState } from 'react';
import type { InspectionRoutePlan } from '@pcr/domain';
import type { InspectionJob, PeopleDirectoryEntry, PropertyRecord } from '../../types/platform';
import { createRoutePlan, listRoutePlans, optimiseRoutePlan, publishRoutePlan } from '../../services/platform/enhancementService';
import { listInspectionJobs } from '../../services/platform/inspectionJobService';
import { listPeople } from '../../services/platform/peopleService';
import { listProperties } from '../../services/platform/propertyService';

const TERMINAL_JOB_STATUSES = new Set(['finalised', 'archived', 'cancelled']);

function propertyLabel(property: PropertyRecord | undefined, fallback: string): string {
  if (!property) return fallback;
  return [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ');
}

function personLabel(person: PeopleDirectoryEntry | undefined, fallback: string): string {
  if (!person) return fallback || 'Inspector not assigned';
  return person.displayName || person.identity?.displayName || person.email || fallback;
}

const InspectionPlannerPage: React.FC = () => {
  const [plans, setPlans] = useState<InspectionRoutePlan[]>([]);
  const [people, setPeople] = useState<PeopleDirectoryEntry[]>([]);
  const [jobs, setJobs] = useState<InspectionJob[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [inspectorId, setInspectorId] = useState('');
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextPlans, nextPeople, nextJobs, nextProperties] = await Promise.all([
        listRoutePlans(),
        listPeople(),
        listInspectionJobs(),
        listProperties(),
      ]);
      setPlans(nextPlans);
      setPeople(nextPeople);
      setJobs(nextJobs);
      setProperties(nextProperties);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const propertyById = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const personById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const inspectors = useMemo(
    () => people.filter((person) => person.membershipStatus === 'active' && (
      person.role === 'inspector' || person.workforceProfile?.disciplines.includes('inspection')
    )),
    [people],
  );
  const eligibleJobs = useMemo(
    () => jobs.filter((job) => !TERMINAL_JOB_STATUSES.has(job.status)),
    [jobs],
  );

  const openCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setName(`Route ${today}`);
    setServiceDate(today);
    setInspectorId('');
    setSelectedJobIds([]);
    setError('');
    setSuccess('');
    setShowCreate(true);
  };

  const toggleJob = (jobId: string) => {
    setSelectedJobIds((current) => current.includes(jobId)
      ? current.filter((id) => id !== jobId)
      : [...current, jobId]);
  };

  const create = async () => {
    setError('');
    setSuccess('');
    if (!name.trim()) return setError('Route plan name is required.');
    if (!serviceDate) return setError('Service date is required.');
    if (!inspectorId) return setError('Select an inspector before creating the route plan.');
    const duplicate = plans.find((plan) => plan.inspectorId === inspectorId && plan.serviceDate === serviceDate && !['completed', 'cancelled'].includes(plan.status));
    if (duplicate) return setError(`A ${duplicate.status} route plan already exists for this inspector on ${serviceDate}.`);

    const selectedJobs = eligibleJobs.filter((job) => selectedJobIds.includes(job.id));
    const stops = selectedJobs.map((job) => {
      const property = propertyById.get(job.propertyId);
      return {
        id: `route-stop-${job.id}`,
        inspectionJobId: job.id,
        propertyId: job.propertyId,
        address: propertyLabel(property, job.propertyId),
        durationMinutes: Math.max(1, job.durationMinutes || 60),
        ...(job.scheduledAt ? { scheduledStartAt: job.scheduledAt } : {}),
        ...(job.scheduledEndAt ? { scheduledEndAt: job.scheduledEndAt } : {}),
        ...(property?.accessDetails?.accessNotes ? { accessNotes: property.accessDetails.accessNotes } : {}),
        ...(property?.accessDetails?.keyNumbers ? { keyRequired: true } : {}),
      };
    });

    setBusy(true);
    try {
      await createRoutePlan({
        name: name.trim(),
        inspectorId,
        serviceDate,
        timezone: 'Australia/Perth',
        status: 'draft',
        stops,
        travel: [],
      });
      setShowCreate(false);
      setSuccess(`Route plan created with ${stops.length} stop${stops.length === 1 ? '' : 's'}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (plan: InspectionRoutePlan, action: 'optimise' | 'publish') => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (action === 'optimise') {
        await optimiseRoutePlan(plan);
        setSuccess('Route order updated.');
      } else {
        if (!plan.inspectorId) throw new Error('Assign an inspector before publishing this route.');
        if (!plan.stops.length) throw new Error('Add at least one inspection job before publishing this route.');
        await publishRoutePlan(plan);
        setSuccess('Route published to the linked inspection jobs.');
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inspection Planner</h1>
          <p className="text-sm text-gray-600">Build, optimise and publish inspector routes without changing the inspection evidence workflow.</p>
        </div>
        <button className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={openCreate}>New route plan</button>
      </header>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {success && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}

      {loading ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading route plans and scheduling data...</div>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center">
          <div className="font-semibold text-gray-900">No route plans yet</div>
          <p className="mt-1 text-sm text-gray-500">Create a route only after selecting an inspector, service date and the inspection jobs to include.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {plans.map((plan) => (
            <article key={plan.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{plan.name || `Route ${plan.serviceDate}`}</div>
                  <div className="text-sm text-gray-600">{plan.serviceDate} · {personLabel(personById.get(plan.inspectorId), plan.inspectorId)}</div>
                  <div className="mt-1 text-sm text-gray-500">{plan.stops.length} stops · {plan.status} · {Math.round((plan.totalDistanceMetres || 0) / 1000)} km</div>
                </div>
                <div className="flex gap-2">
                  <button className="rounded border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void act(plan, 'optimise')} disabled={busy || plan.stops.length < 2 || plan.status === 'published'}>Optimise</button>
                  <button className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void act(plan, 'publish')} disabled={busy || plan.status === 'published' || !plan.inspectorId || plan.stops.length === 0}>Publish</button>
                </div>
              </div>
              {plan.stops.length ? (
                <ol className="mt-3 grid gap-2">
                  {plan.stops.map((stop, index) => (
                    <li key={stop.id} className="rounded bg-gray-50 px-3 py-2 text-sm">
                      <strong>{index + 1}. {stop.address}</strong>
                      <span className="ml-2 text-gray-500">{stop.scheduledStartAt ? new Date(stop.scheduledStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unscheduled'}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="mt-3 text-sm text-gray-500">Draft has no inspection stops yet and cannot be published.</p>}
            </article>
          ))}
        </div>
      )}

      {showCreate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="route-plan-dialog-title">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><h2 id="route-plan-dialog-title" className="text-lg font-bold">New route plan</h2><p className="text-sm text-gray-500">Nothing is saved until you confirm Create route plan.</p></div>
              <button type="button" className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" onClick={() => setShowCreate(false)}>Close</button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">Plan name<input className="rounded border px-3 py-2 font-normal" value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className="grid gap-1 text-sm font-medium">Service date<input type="date" className="rounded border px-3 py-2 font-normal" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>
              <label className="grid gap-1 text-sm font-medium sm:col-span-2">Inspector
                <select className="rounded border px-3 py-2 font-normal" value={inspectorId} onChange={(event) => setInspectorId(event.target.value)}>
                  <option value="">Select active inspector</option>
                  {inspectors.map((person) => <option key={person.id} value={person.id}>{personLabel(person, person.id)}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-5">
              <div className="text-sm font-semibold">Inspection jobs</div>
              <p className="text-xs text-gray-500">Select the jobs that should become route stops. You can create an empty draft, but it cannot be published.</p>
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border">
                {eligibleJobs.length === 0 ? <div className="p-4 text-sm text-gray-500">No active inspection jobs are available.</div> : eligibleJobs.map((job) => (
                  <label key={job.id} className="flex cursor-pointer items-start gap-3 border-b p-3 text-sm last:border-b-0 hover:bg-gray-50">
                    <input type="checkbox" className="mt-1" checked={selectedJobIds.includes(job.id)} onChange={() => toggleJob(job.id)} />
                    <span className="min-w-0"><span className="block font-semibold text-gray-900">{propertyLabel(propertyById.get(job.propertyId), job.propertyId)}</span><span className="block text-xs text-gray-500">{job.reportType} · {job.status.replaceAll('_', ' ')}{job.scheduledAt ? ` · ${new Date(job.scheduledAt).toLocaleString('en-AU')}` : ' · unscheduled'}</span></span>
                  </label>
                ))}
              </div>
            </div>
            {inspectors.length === 0 ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No active user is currently configured as an inspector or inspection-qualified workforce member.</div> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded border px-4 py-2 text-sm font-semibold" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</button>
              <button type="button" className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void create()} disabled={busy || !name.trim() || !serviceDate || !inspectorId}>{busy ? 'Creating...' : 'Create route plan'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
export default InspectionPlannerPage;
