import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import type { TenantInstruction, TenantInstructionType } from '../../types/platform';
import {
  createTenantInstruction,
  generateAccessGrant,
  transitionTenantInstruction,
} from '../../services/platform/maintenanceService';
import {
  getTenantOverview,
  queueTenantCommunication,
  type TenantOverview,
} from '../../services/platform/tenantDirectoryService';
import {
  listTenantActionQueue,
  type TenantActionQueueItem,
} from '../../services/platform/tenantActionQueueService';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const TenantFollowUpPage: React.FC = () => {
  const [instructions, setInstructions] = useState<TenantActionQueueItem[]>([]);
  const [overview, setOverview] = useState<TenantOverview>({ rows: [], stats: { activeTenants: 0, activeTenancies: 0, upcoming: 0, vacating: 0, awaitingTenant: 0, openMaintenance: 0 } });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [instructionType, setInstructionType] = useState<TenantInstructionType>('cleaning_request');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [dueDate, setDueDate] = useState('');

  const fetchInstructions = async () => {
    setLoading(true); setError(null);
    try {
      const [queue, tenantOverview] = await Promise.all([listTenantActionQueue(), getTenantOverview()]);
      setInstructions(queue); setOverview(tenantOverview);
    } catch (err) { setError(errorMessage(err, 'Tenant actions could not be loaded.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void fetchInstructions(); }, []);

  const selected = overview.rows.find((row) => row.tenant.id === tenantId);
  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected?.tenancy || !selected.property || !title.trim() || !instruction.trim()) return;
    setBusyId('create'); setError(null);
    try {
      await createTenantInstruction({
        propertyId: selected.property.id,
        tenancyId: selected.tenancy.id,
        type: instructionType,
        title: title.trim(),
        instruction: instruction.trim(),
        sourceEvidenceIds: [],
        responseRequired: true,
        ...(dueDate ? { dueDate } : {}),
      });
      setShowModal(false); setTenantId(''); setTitle(''); setInstruction(''); setDueDate('');
      await fetchInstructions(); setNotice('Tenant action draft created. Use the tenant workspace when the action needs source-report evidence.');
    } catch (err) { setError(errorMessage(err, 'Failed to create tenant action.')); }
    finally { setBusyId(null); }
  };

  const runAction = async (item: TenantInstruction, action: Parameters<typeof transitionTenantInstruction>[1], body: Record<string, unknown> = {}) => {
    setBusyId(item.id); setError(null);
    try { await transitionTenantInstruction(item.id, action, item.version, body); await fetchInstructions(); }
    catch (err) { setError(errorMessage(err, `Tenant action ${action} failed.`)); }
    finally { setBusyId(null); }
  };

  const handleIssue = async (item: TenantActionQueueItem) => {
    const recipientEmail = item.tenant?.email?.trim().toLowerCase();
    if (!recipientEmail || !item.tenant) { setError('A verified active tenant email is required before this action can be issued.'); return; }
    setBusyId(item.id); setError(null);
    try {
      const issued = await transitionTenantInstruction(item.id, 'issue', item.version);
      const grant = await generateAccessGrant('tenant_instruction', issued.id, recipientEmail, 168);
      const url = `${window.location.origin}${grant.accessUrl}`;
      await queueTenantCommunication({
        tenantId: item.tenant.id,
        tenancyId: item.tenancyId,
        propertyId: item.propertyId,
        channel: 'email',
        recipient: recipientEmail,
        subject: `Action required: ${item.title}`,
        message: `${item.instruction}\n\nRespond securely: ${url}`,
        relatedEntityType: 'tenant_instruction',
        relatedEntityId: item.id,
      });
      await fetchInstructions(); setNotice('Tenant action issued and delivery queued.');
    } catch (err) { setError(errorMessage(err, 'Tenant action could not be issued.')); }
    finally { setBusyId(null); }
  };

  const actionButtons = (item: TenantActionQueueItem) => {
    const busy = busyId === item.id;
    if (item.status === 'draft') return <><Button disabled={busy} onClick={() => void runAction(item, 'request_approval')}>Request Approval</Button><Button danger disabled={busy} onClick={() => void runAction(item, 'cancel', { reason: 'Cancelled before approval.' })}>Cancel</Button></>;
    if (item.status === 'approval_required') return <Button primary disabled={busy} onClick={() => void runAction(item, 'approve')}>Approve</Button>;
    if (item.status === 'approved') return <Button primary disabled={busy} onClick={() => void handleIssue(item)}>Issue & Notify</Button>;
    if (item.status === 'issued' || item.status === 'viewed') return <><Button disabled={busy} onClick={() => void runAction(item, 'await_action')}>Await Action</Button><Button danger disabled={busy} onClick={() => { const reason = window.prompt('Withdrawal reason:')?.trim(); if (reason) void runAction(item, 'withdraw', { reason }); }}>Withdraw</Button></>;
    if (item.status === 'tenant_responded') return <Button primary disabled={busy} onClick={() => void runAction(item, 'review_response')}>Review Response</Button>;
    if (item.status === 'review_required') return <Button primary disabled={busy} onClick={() => { const reason = window.prompt('Resolution note:')?.trim(); if (reason) void runAction(item, 'resolve', { reason }); }}>Resolve</Button>;
    if (item.status === 'resolved') return <Button disabled={busy} onClick={() => void runAction(item, 'close')}>Close</Button>;
    return null;
  };

  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold text-gray-900">Tenant Actions</h1><p className="text-sm text-gray-500">Agency queue for tenant follow-up, approval, issue, response and resolution. Report-linked evidence actions can be created from the individual Tenant Workspace.</p></div><div className="flex items-center gap-3"><button onClick={() => void fetchInstructions()} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium"><RefreshCw size={16} /> Refresh</button><button onClick={() => setShowModal(true)} className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"><Plus size={16} /> New Tenant Action</button></div></div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    {loading ? <div className="p-8 text-center text-sm text-gray-500">Loading tenant actions...</div> : instructions.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No tenant actions recorded.</div> : <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm"><table className="w-full text-left text-sm text-gray-600"><thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-gray-500"><tr><th className="px-4 py-3">Tenant / Property</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Tenant Response</th><th className="px-4 py-3 text-right">Workflow</th></tr></thead><tbody className="divide-y divide-gray-200">{instructions.map((item) => <tr key={item.id} className="hover:bg-gray-50"><td className="px-4 py-3"><div className="font-semibold text-gray-900">{item.tenant?.fullName || 'Tenant not linked'}</div><div className="text-xs text-gray-500">{item.property?.address || item.propertyId}</div>{item.tenant?.id && <Link to={`/app/admin/tenants/${item.tenant.id}`} className="text-xs text-blue-600">Open workspace</Link>}</td><td className="px-4 py-3"><div className="font-medium text-gray-900">{item.title}</div><div className="text-xs capitalize text-gray-400">{item.type.replaceAll('_', ' ')}</div>{item.sourceReportId && <div className="mt-1 text-[11px] text-blue-600">Linked inspection report</div>}</td><td className="px-4 py-3"><span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold capitalize">{item.status.replaceAll('_', ' ')}</span></td><td className="px-4 py-3 text-xs">{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : 'Not set'}</td><td className="px-4 py-3 text-xs">{item.tenantResponseNote || 'No response yet'}</td><td className="px-4 py-3"><div className="flex justify-end gap-2">{actionButtons(item)}</div></td></tr>)}</tbody></table></div>}
    {showModal && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><h2 className="text-lg font-bold text-gray-900">Create Tenant Action Draft</h2><p className="mt-1 text-xs text-gray-500">Select the tenant. Property and tenancy are resolved automatically. For actions sourced from a report area/photo, use the tenant workspace.</p><form onSubmit={handleCreate} className="mt-4 space-y-4"><label className="block text-xs font-medium text-gray-700">Tenant<select required value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"><option value="">Select active tenant</option>{overview.rows.filter((row) => row.tenancy && !['ended','cancelled'].includes(row.lifecycle)).map((row) => <option key={row.tenant.id} value={row.tenant.id}>{row.tenant.fullName} · {row.property?.address || 'No property'}</option>)}</select></label>{selected?.tenant && <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><b>{selected.tenant.fullName}</b><br />{selected.property?.address}<br />Tenancy: {selected.lifecycle}</div>}<label className="block text-xs font-medium text-gray-700">Action Type<select value={instructionType} onChange={(event) => setInstructionType(event.target.value as TenantInstructionType)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"><option value="cleaning_request">Cleaning Request</option><option value="access_request">Access Request</option><option value="photo_request">Photograph / Evidence Request</option><option value="info_request">Information Request</option><option value="general_followup">General Follow-Up</option></select></label><label className="block text-xs font-medium text-gray-700">Title<input required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></label><label className="block text-xs font-medium text-gray-700">Instruction<textarea rows={4} required value={instruction} onChange={(event) => setInstruction(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></label><label className="block text-xs font-medium text-gray-700">Due Date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></label><div className="flex justify-end gap-3"><button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium">Cancel</button><button disabled={busyId === 'create' || !selected?.tenancy} className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">Create Draft</button></div></form></div></div>}
  </div>;
};

const Button: React.FC<{ children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }> = ({ children, onClick, disabled, primary, danger }) => <button disabled={disabled} type="button" onClick={onClick} className={`rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${primary ? 'bg-blue-600 text-white' : danger ? 'border border-rose-200 bg-rose-50 text-rose-700' : 'border border-gray-300 bg-white text-gray-700'}`}>{children}</button>;

export default TenantFollowUpPage;
