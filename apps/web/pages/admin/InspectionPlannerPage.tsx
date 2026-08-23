import React, { useEffect, useState } from 'react';
import type { InspectionRoutePlan } from '@pcr/domain';
import { createRoutePlan, listRoutePlans, optimiseRoutePlan, publishRoutePlan } from '../../services/platform/enhancementService';

const InspectionPlannerPage: React.FC = () => {
  const [plans, setPlans] = useState<InspectionRoutePlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => { try { setPlans(await listRoutePlans()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  useEffect(() => { void load(); }, []);
  const create = async () => { setBusy(true); setError(''); try { const today = new Date().toISOString().slice(0, 10); await createRoutePlan({ inspectorId: '', serviceDate: today, timezone: 'Australia/Perth', status: 'draft', stops: [], travel: [] }); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const act = async (plan: InspectionRoutePlan, action: 'optimise' | 'publish') => {
    setBusy(true);
    setError('');
    try {
      if (action === 'optimise') {
        await optimiseRoutePlan(plan);
      } else {
        await publishRoutePlan(plan);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return <section className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Inspection Planner</h1><p className="text-sm text-gray-600">Build, optimise and publish inspector routes without changing the inspection evidence workflow.</p></div><button className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white" disabled={busy} onClick={() => void create()}>New route plan</button></header>{error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}<div className="grid gap-3">{plans.map((plan) => <article key={plan.id} className="rounded-xl border border-gray-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold">{plan.serviceDate} · {plan.inspectorId || 'Inspector not assigned'}</div><div className="text-sm text-gray-500">{plan.stops.length} stops · {plan.status} · {Math.round((plan.totalDistanceMetres || 0) / 1000)} km</div></div><div className="flex gap-2"><button className="rounded border px-3 py-1.5 text-sm" onClick={() => void act(plan, 'optimise')} disabled={busy}>Optimise</button><button className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white" onClick={() => void act(plan, 'publish')} disabled={busy || plan.status === 'published'}>Publish</button></div></div><ol className="mt-3 grid gap-2">{plan.stops.map((stop, index) => <li key={stop.id} className="rounded bg-gray-50 px-3 py-2 text-sm"><strong>{index + 1}. {stop.address}</strong><span className="ml-2 text-gray-500">{stop.scheduledStartAt ? new Date(stop.scheduledStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unscheduled'}</span></li>)}</ol></article>)}</div></section>;
};
export default InspectionPlannerPage;
