import React, { useEffect, useState } from 'react';
import { Building2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getMaintenanceClientContext, type MaintenanceClientContext } from '../../services/platform/clientManagementService';
import { listMaintenanceQuotes } from '../../services/platform/maintenanceCommercialService';

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

const MaintenanceClientContextPanel: React.FC<{ maintenanceId: string }> = ({ maintenanceId }) => {
  const [context, setContext] = useState<MaintenanceClientContext>();
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = async () => {
    setLoading(true); setError('');
    try {
      const quotes = await listMaintenanceQuotes();
      const quote = quotes
        .filter((candidate) => candidate.maintenanceItemId === maintenanceId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      const value = quote?.total || 0;
      setAmount(value);
      setContext(await getMaintenanceClientContext(maintenanceId, value));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Client approval context could not be resolved.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, [maintenanceId]);

  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><Building2 size={18} className="text-blue-600"/><h2 className="font-black text-slate-950">Client & Approval Authority</h2></div><p className="mt-2 text-xs text-slate-500">The current Property–Client relationship determines who receives maintenance quotes and which delegated approval rules apply.</p></div><button onClick={() => void reload()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"><RefreshCw size={13}/> Refresh authority</button></div>
    {error && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{error}</div>}
    {context && <div className="mt-5 grid gap-4 lg:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Client Account</div>{context.context.snapshot ? <><Link to={`/app/admin/clients/${encodeURIComponent(context.context.snapshot.clientAccountId)}`} className="mt-2 block font-black text-blue-700">{context.context.snapshot.clientName}</Link><div className="mt-1 text-xs text-slate-500">{label(context.context.snapshot.clientType)}</div>{context.context.snapshot.propertyManager && <div className="mt-3 text-xs"><b>Property Manager:</b> {context.context.snapshot.propertyManager.name}</div>}</> : <div className="mt-2 text-sm text-slate-500">No Client relationship resolved.</div>}</div><div className="rounded-xl bg-slate-50 p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Approval routing</div><div className="mt-2 flex items-center gap-2 font-black"><ShieldCheck size={16}/>{label(context.approval.recipientType)}</div><div className="mt-2 text-sm text-slate-700">{context.approval.recipient?.name || 'No approver configured'}</div><div className="text-xs text-slate-400">{context.approval.recipient?.email || ''}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Current commercial amount</div><div className="mt-2 text-2xl font-black">${amount.toFixed(2)}</div><div className="mt-2 space-y-1 text-xs text-slate-500">{context.approval.reasons.map((reason) => <div key={reason}>• {reason}</div>)}</div></div></div>}
  </section>;
};

export default MaintenanceClientContextPanel;
