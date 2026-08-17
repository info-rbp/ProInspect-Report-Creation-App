import React, { useEffect, useState } from 'react';
import { Copy, Plus, RefreshCw } from 'lucide-react';
import type { TenantInstruction, TenantInstructionType } from '../../types/platform';
import {
  createTenantInstruction,
  generateAccessGrant,
  listTenantInstructions,
  transitionTenantInstruction,
} from '../../services/platform/maintenanceService';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const TenantFollowUpPage: React.FC = () => {
  const [instructions, setInstructions] = useState<TenantInstruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const [propertyId, setPropertyId] = useState('');
  const [tenancyId, setTenancyId] = useState('');
  const [instructionType, setInstructionType] = useState<TenantInstructionType>('cleaning_request');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  const fetchInstructions = async () => {
    setLoading(true);
    setError(null);
    try {
      setInstructions(await listTenantInstructions());
    } catch (err) {
      console.error('Failed to load tenant instructions', err);
      setError(errorMessage(err, 'Tenant instructions could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchInstructions();
  }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!propertyId.trim() || !tenancyId.trim() || !title.trim() || !instruction.trim()) return;
    setError(null);
    try {
      const created = await createTenantInstruction({
        propertyId: propertyId.trim(),
        tenancyId: tenancyId.trim(),
        type: instructionType,
        title: title.trim(),
        instruction: instruction.trim(),
        sourceEvidenceIds: [],
        responseRequired: true,
        ...(dueDate ? { dueDate } : {}),
      });
      setShowModal(false);
      setTitle('');
      setInstruction('');
      setDueDate('');
      setInstructions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      await fetchInstructions();
    } catch (err) {
      console.error('Failed to create tenant instruction', err);
      setError(errorMessage(err, 'Failed to create tenant instruction.'));
    }
  };

  const runAction = async (
    item: TenantInstruction,
    action: Parameters<typeof transitionTenantInstruction>[1],
    body: Record<string, unknown> = {},
  ) => {
    setBusyId(item.id);
    setError(null);
    try {
      await transitionTenantInstruction(item.id, action, item.version, body);
      await fetchInstructions();
    } catch (err) {
      setError(errorMessage(err, `Tenant instruction action ${action} failed.`));
    } finally {
      setBusyId(null);
    }
  };

  const handleIssue = async (item: TenantInstruction) => {
    const recipientEmail = window.prompt('Tenant email address for the scoped access link:')?.trim().toLowerCase();
    if (!recipientEmail) return;
    setBusyId(item.id);
    setError(null);
    try {
      const issued = await transitionTenantInstruction(item.id, 'issue', item.version);
      const grant = await generateAccessGrant('tenant_instruction', issued.id, recipientEmail, 168);
      setGeneratedLink(`${window.location.origin}${grant.accessUrl}`);
      await fetchInstructions();
    } catch (err) {
      setError(errorMessage(err, 'Tenant instruction could not be issued.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleResolve = async (item: TenantInstruction) => {
    const reason = window.prompt('Resolution note:')?.trim();
    if (!reason) return;
    await runAction(item, 'resolve', { reason });
  };

  const handleWithdraw = async (item: TenantInstruction) => {
    const reason = window.prompt('Reason for withdrawing this instruction:')?.trim();
    if (!reason) return;
    await runAction(item, 'withdraw', { reason });
  };

  const actionButtons = (item: TenantInstruction) => {
    const busy = busyId === item.id;
    if (item.status === 'draft') return <><button disabled={busy} onClick={() => void runAction(item, 'request_approval')} className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 disabled:opacity-50">Request Approval</button><button disabled={busy} onClick={() => void runAction(item, 'cancel', { reason: 'Cancelled before approval.' })} className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 disabled:opacity-50">Cancel</button></>;
    if (item.status === 'approval_required') return <button disabled={busy} onClick={() => void runAction(item, 'approve')} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Approve</button>;
    if (item.status === 'approved') return <button disabled={busy} onClick={() => void handleIssue(item)} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Issue to Tenant</button>;
    if (item.status === 'issued' || item.status === 'viewed') return <><button disabled={busy} onClick={() => void runAction(item, 'await_action')} className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 disabled:opacity-50">Await Action</button><button disabled={busy} onClick={() => void handleWithdraw(item)} className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 disabled:opacity-50">Withdraw</button></>;
    if (item.status === 'tenant_responded') return <button disabled={busy} onClick={() => void runAction(item, 'review_response')} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Review Response</button>;
    if (item.status === 'review_required') return <button disabled={busy} onClick={() => void handleResolve(item)} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Resolve</button>;
    if (item.status === 'resolved') return <button disabled={busy} onClick={() => void runAction(item, 'close')} className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 disabled:opacity-50">Close</button>;
    return null;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant Follow-Up Workflows</h1>
          <p className="text-sm text-gray-500">Issue factual tenant follow-up instructions and track responses without changing the source inspection report.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => void fetchInstructions()} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><RefreshCw size={16} /> Refresh</button>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"><Plus size={16} /> New Tenant Instruction</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {generatedLink && <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900"><div className="font-bold">Tenant Scoped Access Link Generated</div><div className="flex items-center gap-2 rounded border border-blue-200 bg-white p-2 font-mono text-gray-800"><span className="min-w-0 flex-1 break-all">{generatedLink}</span><button onClick={() => void navigator.clipboard.writeText(generatedLink)} className="p-1 text-blue-700 hover:text-blue-900" title="Copy link"><Copy size={16} /></button></div><p className="text-blue-700">This time-limited link only exposes the approved and issued tenant instruction.</p></div>}

      {loading ? <div className="p-8 text-center text-sm text-gray-500">Loading instructions...</div> : instructions.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No tenant instructions recorded.</div> : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-gray-500"><tr><th className="px-4 py-3">Title / Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Issued Date</th><th className="px-4 py-3">Tenant Response</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-gray-200">
              {instructions.map((item) => <tr key={item.id} className="hover:bg-gray-50"><td className="px-4 py-3 font-medium text-gray-900"><div>{item.title}</div><div className="text-xs capitalize text-gray-400">{item.type.replaceAll('_', ' ')}</div></td><td className="px-4 py-3"><span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold capitalize ${item.status === 'resolved' || item.status === 'closed' ? 'bg-emerald-100 text-emerald-800' : item.status === 'tenant_responded' || item.status === 'review_required' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>{item.status.replaceAll('_', ' ')}</span></td><td className="px-4 py-3 text-xs text-gray-500">{item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : 'Not issued'}</td><td className="px-4 py-3 text-xs text-gray-600">{item.tenantResponseNote || 'No response yet'}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">{actionButtons(item)}</div></td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><h2 className="text-lg font-bold text-gray-900">Create Tenant Instruction Draft</h2><p className="mt-1 text-xs text-gray-500">Creation only produces a draft. Approval and issue are separate audited lifecycle actions.</p><form onSubmit={handleCreate} className="mt-4 space-y-4"><div><label className="block text-xs font-medium text-gray-700">Instruction Type</label><select value={instructionType} onChange={(event) => setInstructionType(event.target.value as TenantInstructionType)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"><option value="cleaning_request">Cleaning Request</option><option value="access_request">Access Request</option><option value="photo_request">Photograph Request</option><option value="info_request">Information Request</option><option value="general_followup">General Follow-Up</option></select></div><div><label className="block text-xs font-medium text-gray-700">Property ID</label><input required value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></div><div><label className="block text-xs font-medium text-gray-700">Tenancy ID</label><input required value={tenancyId} onChange={(event) => setTenancyId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></div><div><label className="block text-xs font-medium text-gray-700">Title</label><input type="text" required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></div><div><label className="block text-xs font-medium text-gray-700">Instruction Details</label><textarea rows={3} required value={instruction} onChange={(event) => setInstruction(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></div><div><label className="block text-xs font-medium text-gray-700">Due Date</label><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" /></div><div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100">Cancel</button><button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800">Create Draft</button></div></form></div></div>}
    </div>
  );
};

export default TenantFollowUpPage;
