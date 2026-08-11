import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileText,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  UserCheck,
} from 'lucide-react';
import type { TenantInstruction, TenantInstructionType } from '../../types/platform';
import {
  createTenantInstruction,
  generateAccessGrant,
  listTenantInstructions,
  updateTenantInstruction,
} from '../../services/platform/maintenanceService';

const TenantFollowUpPage: React.FC = () => {
  const [instructions, setInstructions] = useState<TenantInstruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form
  const [propertyId, setPropertyId] = useState('prop-1');
  const [tenancyId, setTenancyId] = useState('ten-1');
  const [instructionType, setInstructionType] = useState<TenantInstructionType>('cleaning_remediation');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [responseRequiredBy, setResponseRequiredBy] = useState('');

  // Generated Link
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  const fetchInstructions = async () => {
    setLoading(true);
    try {
      const data = await listTenantInstructions();
      setInstructions(data);
    } catch (err) {
      console.error('Failed to load tenant instructions', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstructions();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const inst = await createTenantInstruction({
        propertyId,
        tenancyId,
        instructionType,
        title,
        description,
        status: 'issued',
        responseRequiredBy: responseRequiredBy || undefined,
        issuedAt: new Date().toISOString(),
      });

      // Generate Access Grant Link for tenant
      const grant = await generateAccessGrant('tenant_instruction', inst.id, 'tenant@example.com', 168);
      setGeneratedLink(`${window.location.origin}${grant.accessUrl}`);

      setShowModal(false);
      setTitle('');
      setDescription('');
      await fetchInstructions();
    } catch (err) {
      alert('Failed to issue tenant instruction.');
    }
  };

  const handleResolve = async (inst: TenantInstruction) => {
    try {
      await updateTenantInstruction(
        inst.id,
        {
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
          agentResolutionNote: 'Resolved by agency reviewer.',
        },
        inst.version,
      );
      await fetchInstructions();
    } catch (err) {
      alert('Failed to resolve instruction.');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant Follow-Up Workflows</h1>
          <p className="text-sm text-gray-500">
            Issue tenant operational advice, request cleaning or maintenance remediation, and track responses.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchInstructions}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Plus size={16} />
            New Tenant Instruction
          </button>
        </div>
      </div>

      {generatedLink && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900 space-y-2">
          <div className="font-bold">Tenant Scoped Access Link Generated:</div>
          <div className="flex items-center gap-2 font-mono bg-white p-2 rounded border border-blue-200 text-gray-800 break-all">
            <span>{generatedLink}</span>
            <button
              onClick={() => navigator.clipboard.writeText(generatedLink)}
              className="p-1 text-blue-700 hover:text-blue-900"
              title="Copy link"
            >
              <Copy size={16} />
            </button>
          </div>
          <p className="text-blue-700">
            Send this time-limited link to the tenant to allow them to view instructions and upload photos or comments.
          </p>
        </div>
      )}

      {/* Instruction List */}
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-500">Loading instructions...</div>
      ) : instructions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No tenant instructions recorded.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Title / Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Issued Date</th>
                <th className="px-4 py-3">Tenant Response</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {instructions.map((inst) => (
                <tr key={inst.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div>{inst.title}</div>
                    <div className="text-xs text-gray-400 capitalize">{inst.instructionType.replaceAll('_', ' ')}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold capitalize ${
                        inst.status === 'resolved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : inst.status === 'tenant_responded'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {inst.status.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {inst.issuedAt ? new Date(inst.issuedAt).toLocaleDateString() : 'Draft'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {inst.tenantResponseNote || 'No response yet'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {inst.status !== 'resolved' && (
                      <button
                        onClick={() => handleResolve(inst)}
                        className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Mark Resolved
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Issue Tenant Instruction</h2>
            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700">Instruction Type</label>
                <select
                  value={instructionType}
                  onChange={(e) => setInstructionType(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                >
                  <option value="cleaning_remediation">Cleaning Remediation</option>
                  <option value="maintenance_access">Maintenance Access Request</option>
                  <option value="operational_advice">Operational Advice</option>
                  <option value="garden_upkeep">Garden / Exterior Upkeep</option>
                  <option value="safety_compliance">Safety & Compliance</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mold treatment in bathroom"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Instruction Details</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Neutral, objective instructions for the tenant..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Response Required By Date</label>
                <input
                  type="date"
                  value={responseRequiredBy}
                  onChange={(e) => setResponseRequiredBy(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
                >
                  Issue Instruction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantFollowUpPage;
