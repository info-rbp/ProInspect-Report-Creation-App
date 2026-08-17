import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileText,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ExternalContact, MaintenanceItem, WorkRequest } from '../../types/platform';
import { createMaintenanceFollowUpReport } from '../../services/platform/maintenanceReportService';
import {
  createWorkRequest,
  generateAccessGrant,
  getMaintenanceItem,
  listExternalContacts,
  listWorkRequests,
  transitionMaintenanceItem,
  transitionWorkRequest,
} from '../../services/platform/maintenanceService';

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const MaintenanceDetailPage: React.FC = () => {
  const { maintenanceId } = useParams<{ maintenanceId: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<MaintenanceItem | null>(null);
  const [contacts, setContacts] = useState<ExternalContact[]>([]);
  const [workRequests, setWorkRequests] = useState<WorkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [verificationNote, setVerificationNote] = useState('');

  const loadData = async () => {
    if (!maintenanceId) return;
    setLoading(true);
    setError(null);
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
      setError(message(err, 'Maintenance details could not be loaded.'));
      setItem(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [maintenanceId]);

  const runItemAction = async (
    action: Parameters<typeof transitionMaintenanceItem>[1],
    body: Record<string, unknown> = {},
  ) => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      setItem(await transitionMaintenanceItem(item.id, action, item.version, body));
      await loadData();
    } catch (err) {
      setError(message(err, `Maintenance action ${action} failed.`));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">Loading maintenance details...</div>
    );
  }
  if (!item) {
    return <div className="p-8 text-center text-sm text-gray-500">Maintenance item not found.</div>;
  }

  const handleAssignContractor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedContactId || item.status !== 'approved') return;
    setBusy(true);
    setError(null);
    try {
      const workInstruction = instructions.trim() || item.workInstruction || item.description;
      const assigned = await transitionMaintenanceItem(item.id, 'assign', item.version, {
        externalContactId: selectedContactId,
        workInstruction,
      });
      setItem(assigned);
      const request = await createWorkRequest({
        maintenanceItemId: item.id,
        externalContactId: selectedContactId,
        instructions: workInstruction,
        priority: item.priority,
      });
      const issued = await transitionWorkRequest(request.id, 'issue', request.version);
      const contact = contacts.find((candidate) => candidate.id === selectedContactId);
      if (contact?.email) {
        const grant = await generateAccessGrant('work_request', issued.id, contact.email, 72);
        setGeneratedLink(`${window.location.origin}${grant.accessUrl}`);
      }
      setShowAssignModal(false);
      await loadData();
    } catch (err) {
      console.error('Failed to assign contractor', err);
      setError(message(err, 'Failed to issue contractor work request.'));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitCompletion = async () => {
    const completionNote = window.prompt('Completion note or summary of evidence reviewed:');
    if (!completionNote?.trim()) return;
    await runItemAction('submit_completion', {
      completionNote: completionNote.trim(),
      completionEvidenceIds: item.completionEvidenceIds || [],
    });
  };

  const handleVerifyCompletion = async () => {
    const note = verificationNote.trim();
    if (!note) {
      setError('A verification note is required before completion can be verified.');
      return;
    }
    await runItemAction('verify', {
      verificationMethod: 'completion_evidence_review',
      verificationNote: note,
    });
    setVerificationNote('');
  };

  const handleCloseItem = async () => {
    const reason = window.prompt('Closure reason:');
    if (!reason?.trim()) return;
    await runItemAction('close', { reason: reason.trim() });
  };

  const handleReopen = async () => {
    const reason = window.prompt('Reason for reopening:');
    if (!reason?.trim()) return;
    await runItemAction('reopen', { reason: reason.trim() });
  };

  const handleCancel = async () => {
    const reason = window.prompt('Reason for cancelling this maintenance item:');
    if (!reason?.trim()) return;
    await runItemAction('cancel', { reason: reason.trim() });
  };

  const handleCreateFollowUpReport = async () => {
    setBusy(true);
    setError(null);
    try {
      const aggregate = await createMaintenanceFollowUpReport([item.id]);
      navigate(`/app/admin/reports/${encodeURIComponent(aggregate.report.id)}/edit`);
    } catch (err) {
      setError(message(err, 'Maintenance Follow-Up report could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  const handleWorkRequestAction = async (request: WorkRequest, action: 'accept' | 'cancel') => {
    const reason = action === 'cancel' ? window.prompt('Reason for cancelling this work request:') : undefined;
    if (action === 'cancel' && !reason?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await transitionWorkRequest(
        request.id,
        action,
        request.version,
        reason ? { reason: reason.trim() } : {},
      );
      await loadData();
    } catch (err) {
      setError(message(err, `Work request ${action} failed.`));
    } finally {
      setBusy(false);
    }
  };

  const terminal = ['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'].includes(
    item.status,
  );
  const followUpEligible = ['verification_required', 'verified', 'completed', 'closed'].includes(
    item.status,
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate('/app/admin/maintenance')}
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} /> Back to Maintenance
        </button>
        <div className="flex flex-wrap gap-2">
          {followUpEligible && (
            <button
              disabled={busy}
              onClick={() => void handleCreateFollowUpReport()}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 disabled:opacity-50"
            >
              <FileText size={16} /> Create Follow-Up Report
            </button>
          )}
          {item.status === 'triage_required' && (
            <button
              disabled={busy}
              onClick={() => void runItemAction('approve')}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <ShieldCheck size={16} /> Approve
            </button>
          )}
          {item.status === 'approved' && (
            <button
              disabled={busy}
              onClick={() => setShowAssignModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Send size={16} /> Assign & Issue Work Request
            </button>
          )}
          {item.status === 'assigned' && (
            <button
              disabled={busy}
              onClick={() => void runItemAction('start')}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Play size={16} /> Start Work
            </button>
          )}
          {['in_progress', 'awaiting_completion_evidence'].includes(item.status) && (
            <button
              disabled={busy}
              onClick={() => void handleSubmitCompletion()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <CheckCircle2 size={16} /> Submit Completion
            </button>
          )}
          {item.status === 'verification_required' && (
            <button
              disabled={busy}
              onClick={() => void handleVerifyCompletion()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <CheckCircle2 size={16} /> Verify Completion
            </button>
          )}
          {['verified', 'completed'].includes(item.status) && (
            <button
              disabled={busy}
              onClick={() => void handleCloseItem()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
            >
              Close Item
            </button>
          )}
          {terminal ? (
            <button
              disabled={busy}
              onClick={() => void handleReopen()}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
            >
              <RotateCcw size={16} /> Reopen
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => void handleCancel()}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50"
            >
              <XCircle size={16} /> Cancel
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Maintenance #{item.id.slice(0, 8)}
              </span>
              <div className="flex gap-2">
                <span className="rounded bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize">
                  {item.status.replaceAll('_', ' ')}
                </span>
                <span className="rounded bg-amber-100 px-2.5 py-1 text-xs font-semibold uppercase text-amber-800">
                  {item.priority}
                </span>
              </div>
            </div>
            <h1 className="mt-4 text-xl font-bold text-gray-900">{item.title}</h1>
            <p className="mt-2 text-sm text-gray-600">
              {item.description || 'No description provided.'}
            </p>
            <dl className="mt-4 grid gap-3 border-t border-gray-100 pt-4 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-gray-400">Category</dt>
                <dd className="font-medium text-gray-800">{item.category}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Approval</dt>
                <dd className="font-medium capitalize text-gray-800">
                  {item.approvalStatus.replaceAll('_', ' ')}
                </dd>
              </div>
            </dl>
            {item.workInstruction && (
              <div className="mt-4 rounded-lg bg-gray-50 p-4 text-xs">
                <div className="font-semibold text-gray-700">Approved Work Instruction</div>
                <p className="mt-1 text-gray-600">{item.workInstruction}</p>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">External Work Requests</h2>
            {workRequests.length === 0 ? (
              <p className="mt-3 text-xs text-gray-500">No work requests issued.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {workRequests.map((request) => (
                  <div key={request.id} className="rounded-lg border border-gray-200 p-4 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold capitalize">
                        {request.status.replaceAll('_', ' ')}
                      </span>
                      <span className="text-gray-400">
                        {request.issuedAt ? new Date(request.issuedAt).toLocaleDateString() : ''}
                      </span>
                    </div>
                    <p className="mt-2 text-gray-600">{request.instructions}</p>
                    {request.responseNotes && (
                      <p className="mt-2 rounded bg-emerald-50 p-2 text-emerald-800">
                        Contractor response: {request.responseNotes}
                      </p>
                    )}
                    {request.completionEvidenceIds?.length ? (
                      <div className="mt-2 text-[11px] text-gray-400">
                        Completion evidence IDs: {request.completionEvidenceIds.join(', ')}
                      </div>
                    ) : null}
                    <div className="mt-3 flex justify-end gap-2">
                      {request.status === 'completed' && (
                        <button
                          disabled={busy}
                          onClick={() => void handleWorkRequestAction(request, 'accept')}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-white disabled:opacity-50"
                        >
                          Accept Work
                        </button>
                      )}
                      {['draft', 'issued', 'acknowledged', 'in_progress'].includes(request.status) && (
                        <button
                          disabled={busy}
                          onClick={() => void handleWorkRequestAction(request, 'cancel')}
                          className="rounded border border-rose-200 px-2.5 py-1 text-rose-700 disabled:opacity-50"
                        >
                          Cancel Request
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {generatedLink && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
              <div className="font-bold">Scoped contractor link</div>
              <div className="mt-2 flex items-center gap-2 rounded border border-emerald-200 bg-white p-2 font-mono text-gray-800">
                <span className="min-w-0 flex-1 break-all">{generatedLink}</span>
                <button
                  onClick={() => void navigator.clipboard.writeText(generatedLink)}
                  title="Copy link"
                  className="text-emerald-700"
                >
                  <Copy size={16} />
                </button>
              </div>
              <p className="mt-2 text-emerald-700">
                The link is time-limited and scoped only to this work request.
              </p>
            </section>
          )}
        </div>

        <section className="h-fit rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Verification</h2>
          <div className="mt-3 text-xs">
            <span className="text-gray-400">Status:</span>{' '}
            <span className="font-semibold capitalize">
              {item.verificationStatus.replaceAll('_', ' ')}
            </span>
          </div>
          {item.completionNote && (
            <p className="mt-3 rounded bg-gray-50 p-3 text-xs text-gray-700">
              {item.completionNote}
            </p>
          )}
          {item.status === 'verification_required' && (
            <textarea
              rows={3}
              value={verificationNote}
              onChange={(event) => setVerificationNote(event.target.value)}
              placeholder="Verification note required..."
              className="mt-3 w-full rounded-lg border border-gray-300 p-2 text-xs"
            />
          )}
        </section>
      </div>

      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">
              Assign Contractor & Issue Work Request
            </h2>
            <form onSubmit={handleAssignContractor} className="mt-4 space-y-4">
              <select
                value={selectedContactId}
                onChange={(event) => setSelectedContactId(event.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 p-2 text-sm"
              >
                <option value="">Select contractor...</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.businessName ? ` (${contact.businessName})` : ''}
                  </option>
                ))}
              </select>
              <textarea
                rows={3}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Approved instructions..."
                className="w-full rounded-lg border border-gray-300 p-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-xs"
                >
                  Cancel
                </button>
                <button
                  disabled={busy}
                  type="submit"
                  className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  Assign & Issue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaintenanceDetailPage;
