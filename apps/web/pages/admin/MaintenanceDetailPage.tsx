import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Hammer,
  Send,
  Shield,
  UserCheck,
  Wrench,
} from 'lucide-react';
import type { ExternalContact, MaintenanceItem, WorkRequest } from '../../types/platform';
import {
  createExternalContact,
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

  // New Work Request Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [instructions, setInstructions] = useState('');

  // Generated Link
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  // Verification Form
  const [verificationNote, setVerificationNote] = useState('');

  const loadData = async () => {
    if (!maintenanceId) return;
    setLoading(true);
    try {
      const [itemData, contactList, reqList] = await Promise.all([
        getMaintenanceItem(maintenanceId),
        listExternalContacts(),
        listWorkRequests(),
      ]);
      setItem(itemData);
      setContacts(contactList);
      setWorkRequests(reqList.filter((r) => r.maintenanceItemId === maintenanceId));
    } catch (err) {
      console.error('Failed to load item detail', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [maintenanceId]);

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-500">Loading maintenance details...</div>;
  }

  if (!item) {
    return <div className="p-8 text-center text-sm text-gray-500">Maintenance item not found.</div>;
  }

  const handleAssignContractor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContactId) return;
    try {
      const req = await createWorkRequest({
        maintenanceItemId: item.id,
        externalContactId: selectedContactId,
        instructions: instructions || item.workInstruction || item.description,
        priority: item.priority,
      });

      // Update maintenance item status
      await updateMaintenanceItem(item.id, { status: 'assigned', externalContactId: selectedContactId }, item.version);

      // Generate Access Grant Token
      const contact = contacts.find((c) => c.id === selectedContactId);
      if (contact?.email) {
        const grant = await generateAccessGrant('work_request', req.id, contact.email, 72);
        setGeneratedLink(`${window.location.origin}${grant.accessUrl}`);
      }

      setShowAssignModal(false);
      await loadData();
    } catch (err) {
      alert('Failed to assign work request.');
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
          verificationNote: verificationNote || 'Verified by reviewer.',
        },
        item.version,
      );
      await loadData();
    } catch (err) {
      alert('Failed to verify completion.');
    }
  };

  const handleCloseItem = async () => {
    const reason = prompt('Closure reason:');
    if (!reason) return;
    try {
      await updateMaintenanceItem(
        item.id,
        {
          status: 'closed',
          closedAt: new Date().toISOString(),
          closureReason: reason,
        },
        item.version,
      );
      await loadData();
    } catch (err) {
      alert('Failed to close item.');
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/app/admin/maintenance')}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to Maintenance Operations
        </button>
        <div className="flex items-center gap-3">
          {item.status !== 'closed' && (
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              <Send size={16} />
              Issue Contractor Work Request
            </button>
          )}
          {item.status === 'verification_required' && (
            <button
              onClick={handleVerifyCompletion}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <CheckCircle2 size={16} />
              Verify & Sign Off Completion
            </button>
          )}
          {item.status !== 'closed' && (
            <button
              onClick={handleCloseItem}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close Item
            </button>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Information */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Maintenance Item #{item.id.slice(0, 8)}
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800 capitalize">
                  Status: {item.status.replaceAll('_', ' ')}
                </span>
                <span className="rounded bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 uppercase">
                  {item.priority}
                </span>
              </div>
            </div>

            <div>
              <h1 className="text-xl font-bold text-gray-900">{item.title}</h1>
              <p className="mt-2 text-sm text-gray-600">{item.description || 'No description provided.'}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-xs">
              <div>
                <span className="text-gray-400">Category:</span>
                <span className="ml-2 font-medium text-gray-800">{item.category}</span>
              </div>
              <div>
                <span className="text-gray-400">Approval Requirement:</span>
                <span className="ml-2 font-medium text-gray-800 capitalize">{item.approvalStatus}</span>
              </div>
            </div>

            {item.workInstruction && (
              <div className="rounded-lg bg-gray-50 p-4 text-xs space-y-1">
                <div className="font-semibold text-gray-700">Approved Work Instruction:</div>
                <p className="text-gray-600">{item.workInstruction}</p>
              </div>
            )}
          </div>

          {/* Work Requests Section */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-gray-900">External Work Requests</h2>
            {workRequests.length === 0 ? (
              <div className="text-xs text-gray-500">No external work requests issued for this item.</div>
            ) : (
              <div className="space-y-3">
                {workRequests.map((req) => (
                  <div key={req.id} className="rounded-lg border border-gray-200 p-4 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-800 capitalize">Status: {req.status}</span>
                      <span className="text-gray-400">{req.issuedAt ? new Date(req.issuedAt).toLocaleDateString() : ''}</span>
                    </div>
                    <p className="text-gray-600">{req.instructions}</p>
                    {req.responseNotes && (
                      <div className="rounded bg-emerald-50 p-2 text-emerald-800">
                        <strong>Contractor Response:</strong> {req.responseNotes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Generated Link Alert */}
          {generatedLink && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 space-y-2">
              <div className="font-bold">Contractor Scoped Access Link Generated:</div>
              <div className="flex items-center gap-2 font-mono bg-white p-2 rounded border border-emerald-200 text-gray-800 break-all">
                <span>{generatedLink}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(generatedLink)}
                  className="p-1 text-emerald-700 hover:text-emerald-900"
                  title="Copy link"
                >
                  <Copy size={16} />
                </button>
              </div>
              <p className="text-emerald-700">
                This link is time-limited (72 hours) and scoped strictly to this work request. Send this URL to the contractor to submit response and evidence.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Evidence & Verification */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-3">
            <h2 className="text-base font-bold text-gray-900">Verification & Sign-off</h2>
            <div className="text-xs text-gray-600 space-y-2">
              <div>
                <span className="text-gray-400">Verification Status:</span>
                <span className="ml-2 font-semibold text-gray-800 capitalize">{item.verificationStatus}</span>
              </div>
              {item.completionNote && (
                <div>
                  <span className="text-gray-400">Completion Note:</span>
                  <p className="mt-1 font-medium text-gray-800">{item.completionNote}</p>
                </div>
              )}
              {item.verificationNote && (
                <div className="rounded bg-emerald-50 p-2 text-emerald-800">
                  <strong>Verification Note:</strong> {item.verificationNote}
                </div>
              )}
            </div>

            {item.status === 'verification_required' && (
              <div className="pt-3 border-t border-gray-100 space-y-2">
                <label className="block text-xs font-medium text-gray-700">Reviewer Sign-off Note</label>
                <textarea
                  rows={2}
                  value={verificationNote}
                  onChange={(e) => setVerificationNote(e.target.value)}
                  placeholder="Enter verification comments..."
                  className="w-full rounded border border-gray-300 p-2 text-xs"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Assign Contractor */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Issue Contractor Work Request</h2>
            <form onSubmit={handleAssignContractor} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700">Select External Contact</label>
                <select
                  value={selectedContactId}
                  onChange={(e) => setSelectedContactId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                  required
                >
                  <option value="">Select Contractor...</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.businessName ? `(${c.businessName})` : ''} - {c.email}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Instructions for Contractor</label>
                <textarea
                  rows={3}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Specific tasks, access rules, safety instructions..."
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
                >
                  Issue Work Request
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
