import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Copy, Send } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ExternalContact, MaintenanceItem, WorkRequest } from '../../types/platform';
import {
  createWorkRequest,
  generateAccessGrant,
  getMaintenanceItem,
  listExternalContacts,
  listWorkRequests,
  updateMaintenanceItem,
} from '../../services/platform/maintenanceService';

const MaintenanceDetailPage: React.FC = () => {
  const { maintenanceId } = useParams<{ maintenanceId: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<MaintenanceItem | null>(null);
  const [contacts, setContacts] = useState<ExternalContact[]>([]);
  const [workRequests, setWorkRequests] = useState<WorkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [verificationNote, setVerificationNote] = useState('');

  const loadData = async () => {
    if (!maintenanceId) return;
    setLoading(true);
    try {
      const [itemData, contactList, requestList] = await Promise.all([
        getMaintenanceItem(maintenanceId),
        listExternalContacts(),
        listWorkRequests(),
      ]);
      setItem(itemData);
      setContacts(contactList.filter((contact) => contact.status === 'active'));
      setWorkRequests(requestList.filter((request) => request.maintenanceItemId === maintenanceId));
    } catch (err) {
      console.error('Failed to load maintenance detail', err);
      setItem(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [maintenanceId]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading maintenance details...</div>;
  if (!item) return <div className="p-8 text-center text-sm text-gray-500">Maintenance item not found.</div>;

  const handleAssignContractor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedContactId) return;
    try {
      const request = await createWorkRequest({
        maintenanceItemId: item.id,
        externalContactId: selectedContactId,
        instructions: instructions.trim() || item.workInstruction || item.description,
        priority: item.priority,
        status: 'draft',
      });
      const updatedItem = await updateMaintenanceItem(
        item.id,
        { status: 'assigned', externalContactId: selectedContactId },
        item.version,
      );
      setItem(updatedItem);

      const contact = contacts.find((candidate) => candidate.id === selectedContactId);
      if (contact?.email) {
        const grant = await generateAccessGrant('work_request', request.id, contact.email, 72);
        setGeneratedLink(`${window.location.origin}${grant.accessUrl}`);
      }
      setShowAssignModal(false);
      await loadData();
    } catch (err) {
      console.error('Failed to assign contractor', err);
      alert('Failed to issue contractor work request.');
    }
  };

  const handleVerifyCompletion = async () => {
    try {
      await updateMaintenanceItem(
        item.id,
        {
          status: 'verified',
          verificationStatus: 'verified',
          verificationMethod: 'completion_evidence_review',
          verificationNote: verificationNote.trim() || 'Completion evidence reviewed and verified.',
        },
        item.version,
      );
      await loadData();
    } catch (err) {
      console.error('Failed to verify maintenance completion', err);
      alert('Failed to verify completion.');
    }
  };

  const handleCloseItem = async () => {
    const reason = window.prompt('Closure reason:');
    if (!reason?.trim()) return;
    try {
      await updateMaintenanceItem(
        item.id,
        { status: 'closed', closedAt: new Date().toISOString(), closureReason: reason.trim() },
        item.version,
      );
      await loadData();
    } catch (err) {
      console.error('Failed to close maintenance item', err);
      alert('Failed to close maintenance item.');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate('/app/admin/maintenance')} className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> Back to Maintenance</button>
        <div className="flex flex-wrap gap-2">
          {item.status !== 'closed' && <button onClick={() => setShowAssignModal(true)} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"><Send size={16} /> Issue Work Request</button>}
          {item.status === 'verification_required' && <button onClick={() => void handleVerifyCompletion()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"><CheckCircle2 size={16} /> Verify Completion</button>}
          {item.status !== 'closed' && <button onClick={() => void handleCloseItem()} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700">Close Item</button>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Maintenance #{item.id.slice(0, 8)}</span>
              <div className="flex gap-2"><span className="rounded bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize">{item.status.replaceAll('_', ' ')}</span><span className="rounded bg-amber-100 px-2.5 py-1 text-xs font-semibold uppercase text-amber-800">{item.priority}</span></div>
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">{item.title}</h1>
            <p className="mt-2 text-sm text-gray-600">{item.description || 'No description provided.'}</p>
            <dl className="mt-4 grid gap-3 border-t border-gray-100 pt-4 text-xs sm:grid-cols-2"><div><dt className="text-gray-400">Category</dt><dd className="font-medium text-gray-800">{item.category}</dd></div><div><dt className="text-gray-400">Approval</dt><dd className="font-medium capitalize text-gray-800">{item.approvalStatus.replaceAll('_', ' ')}</dd></div></dl>
            {item.workInstruction && <div className="mt-4 rounded-lg bg-gray-50 p-4 text-xs"><div className="font-semibold text-gray-700">Approved Work Instruction</div><p className="mt-1 text-gray-600">{item.workInstruction}</p></div>}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">External Work Requests</h2>
            {workRequests.length === 0 ? <p className="mt-3 text-xs text-gray-500">No work requests issued.</p> : <div className="mt-3 space-y-3">{workRequests.map((request) => <div key={request.id} className="rounded-lg border border-gray-200 p-4 text-xs"><div className="flex justify-between gap-2"><span className="font-semibold capitalize">{request.status.replaceAll('_', ' ')}</span><span className="text-gray-400">{request.issuedAt ? new Date(request.issuedAt).toLocaleDateString() : ''}</span></div><p className="mt-2 text-gray-600">{request.instructions}</p>{request.responseNotes && <p className="mt-2 rounded bg-emerald-50 p-2 text-emerald-800">Contractor response: {request.responseNotes}</p>}</div>)}</div>}
          </section>

          {generatedLink && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900"><div className="font-bold">Scoped contractor link</div><div className="mt-2 flex items-center gap-2 rounded border border-emerald-200 bg-white p-2 font-mono text-gray-800"><span className="min-w-0 flex-1 break-all">{generatedLink}</span><button onClick={() => void navigator.clipboard.writeText(generatedLink)} title="Copy link" className="text-emerald-700"><Copy size={16} /></button></div><p className="mt-2 text-emerald-700">The link is time-limited and scoped only to this work request.</p></section>}
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm h-fit">
          <h2 className="text-base font-bold text-gray-900">Verification</h2>
          <div className="mt-3 text-xs"><span className="text-gray-400">Status:</span> <span className="font-semibold capitalize">{item.verificationStatus.replaceAll('_', ' ')}</span></div>
          {item.completionNote && <p className="mt-3 rounded bg-gray-50 p-3 text-xs text-gray-700">{item.completionNote}</p>}
          {item.status === 'verification_required' && <textarea rows={3} value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} placeholder="Verification note..." className="mt-3 w-full rounded-lg border border-gray-300 p-2 text-xs" />}
        </section>
      </div>

      {showAssignModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h2 className="text-lg font-bold text-gray-900">Issue Contractor Work Request</h2><form onSubmit={handleAssignContractor} className="mt-4 space-y-4"><select value={selectedContactId} onChange={(event) => setSelectedContactId(event.target.value)} required className="w-full rounded-lg border border-gray-300 p-2 text-sm"><option value="">Select contractor...</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.businessName ? ` (${contact.businessName})` : ''}</option>)}</select><textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Approved instructions..." className="w-full rounded-lg border border-gray-300 p-2 text-sm" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowAssignModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-xs">Cancel</button><button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white">Issue</button></div></form></div></div>}
    </div>
  );
};

export default MaintenanceDetailPage;
