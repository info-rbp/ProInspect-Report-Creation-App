import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Filter,
  Hammer,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { MaintenanceCandidate, MaintenanceCategory, MaintenanceItem, MaintenancePriority } from '../../types/platform';
import {
  confirmMaintenanceCandidate,
  createMaintenanceItem,
  dismissMaintenanceCandidate,
  listMaintenanceCandidates,
  listMaintenanceItems,
} from '../../services/platform/maintenanceService';

const MaintenancePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'items' | 'candidates'>('items');
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [candidates, setCandidates] = useState<MaintenanceCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPropertyId, setNewPropertyId] = useState('prop-1');
  const [newCategory, setNewCategory] = useState<MaintenanceCategory>('General Maintenance');
  const [newPriority, setNewPriority] = useState<MaintenancePriority>('routine');
  const [newDescription, setNewDescription] = useState('');
  const [newWorkInstruction, setNewWorkInstruction] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemList, candidateList] = await Promise.all([
        listMaintenanceItems(),
        listMaintenanceCandidates(),
      ]);
      setItems(itemList);
      setCandidates(candidateList);
    } catch (err) {
      console.error('Failed to load maintenance data', err);
      setError('Could not fetch maintenance items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleConfirmCandidate = async (candidateId: string) => {
    try {
      await confirmMaintenanceCandidate(candidateId);
      await fetchData();
    } catch (err) {
      alert('Failed to confirm candidate.');
    }
  };

  const handleDismissCandidate = async (candidateId: string) => {
    const reason = prompt('Reason for dismissing this candidate:');
    if (!reason) return;
    try {
      await dismissMaintenanceCandidate(candidateId, reason);
      await fetchData();
    } catch (err) {
      alert('Failed to dismiss candidate.');
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await createMaintenanceItem({
        propertyId: newPropertyId,
        title: newTitle,
        category: newCategory,
        priority: newPriority,
        description: newDescription,
        workInstruction: newWorkInstruction,
        status: 'triage_required',
      });
      setShowCreateModal(false);
      setNewTitle('');
      setNewDescription('');
      setNewWorkInstruction('');
      await fetchData();
    } catch (err) {
      alert('Failed to create maintenance item.');
    }
  };

  // Filtered Items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = selectedStatus === 'all' || item.status === selectedStatus;
    const matchesPriority = selectedPriority === 'all' || item.priority === selectedPriority;
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    return matchesSearch && matchesStatus && matchesPriority && matchesCategory;
  });

  const pendingCandidates = candidates.filter((c) => c.reviewStatus === 'suggested');

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Operations</h1>
          <p className="text-sm text-gray-500">
            Triage, approve, assign, and verify maintenance items without altering immutable inspection reports.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Plus size={16} />
            New Maintenance Item
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Pending Triage</span>
            <AlertTriangle className="text-amber-500" size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{pendingCandidates.length}</div>
          <span className="text-xs text-gray-500">Suggested by AI / Inspector</span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Urgent / High</span>
            <ShieldAlert className="text-red-500" size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {items.filter((i) => i.priority === 'urgent' || i.priority === 'high').length}
          </div>
          <span className="text-xs text-gray-500">Active high-priority findings</span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">In Progress</span>
            <Clock className="text-blue-500" size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {items.filter((i) => i.status === 'assigned' || i.status === 'in_progress').length}
          </div>
          <span className="text-xs text-gray-500">Assigned to contractors</span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Needs Verification</span>
            <CheckCircle className="text-emerald-500" size={20} />
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {items.filter((i) => i.status === 'verification_required').length}
          </div>
          <span className="text-xs text-gray-500">Awaiting reviewer completion sign-off</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => setActiveTab('items')}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-medium ${
              activeTab === 'items'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <Hammer size={18} />
            Maintenance Items ({items.length})
          </button>
          <button
            onClick={() => setActiveTab('candidates')}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-medium ${
              activeTab === 'candidates'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <Wrench size={18} />
            Candidate Triage Queue ({pendingCandidates.length})
          </button>
        </nav>
      </div>

      {/* TAB 1: MAINTENANCE ITEMS */}
      {activeTab === 'items' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search maintenance items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 text-sm focus:border-gray-900 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gray-400" />
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-gray-900 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="triage_required">Triage Required</option>
                <option value="approved">Approved</option>
                <option value="assigned">Assigned</option>
                <option value="in_progress">In Progress</option>
                <option value="verification_required">Verification Required</option>
                <option value="verified">Verified</option>
                <option value="closed">Closed</option>
              </select>

              <select
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-gray-900 focus:outline-none"
              >
                <option value="all">All Priorities</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="routine">Routine</option>
                <option value="monitor">Monitor</option>
              </select>
            </div>
          </div>

          {/* List Table */}
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading maintenance items...</div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No maintenance items found matching criteria.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3">Item Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Approval</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <Link to={`/app/admin/maintenance/${item.id}`} className="hover:underline">
                          {item.title}
                        </Link>
                        {item.description && (
                          <div className="line-clamp-1 text-xs text-gray-500 font-normal">{item.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">{item.category}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${
                            item.priority === 'urgent'
                              ? 'bg-red-100 text-red-800'
                              : item.priority === 'high'
                              ? 'bg-amber-100 text-amber-800'
                              : item.priority === 'routine'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {item.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800 capitalize">
                          {item.status.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium capitalize ${
                            item.approvalStatus === 'approved'
                              ? 'text-emerald-600'
                              : item.approvalStatus === 'declined'
                              ? 'text-red-600'
                              : 'text-gray-500'
                          }`}
                        >
                          {item.approvalStatus.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/app/admin/maintenance/${item.id}`}
                          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          View Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CANDIDATE TRIAGE QUEUE */}
      {activeTab === 'candidates' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            <strong>Human Review Mandatory:</strong> Maintenance candidates are findings extracted from inspection reports or suggested by AI. They do not alter the historical report and must be reviewed by staff before converting into an active maintenance item.
          </div>

          {pendingCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No pending maintenance candidates in queue.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pendingCandidates.map((candidate) => (
                <div key={candidate.id} className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 uppercase">
                        Source: {candidate.source}
                      </span>
                      <span className="text-xs font-semibold text-amber-600 uppercase">{candidate.suggestedPriority}</span>
                    </div>

                    <h3 className="text-sm font-bold text-gray-900">{candidate.title}</h3>
                    <p className="text-xs text-gray-600">{candidate.description || 'No additional description provided.'}</p>
                    <div className="text-xs text-gray-400">Category: {candidate.category}</div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
                    <button
                      onClick={() => handleConfirmCandidate(candidate.id)}
                      className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Confirm Item
                    </button>
                    <button
                      onClick={() => handleDismissCandidate(candidate.id)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: New Maintenance Item */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Create New Maintenance Item</h2>
            <form onSubmit={handleCreateItem} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700">Property</label>
                <select
                  value={newPropertyId}
                  onChange={(e) => setNewPropertyId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                >
                  <option value="prop-1">128 Exhibition Street, Melbourne VIC 3000</option>
                  <option value="prop-2">45 Collins Street, Melbourne VIC 3000</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Leaking kitchen mixer tap"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                  >
                    <option value="Plumbing">Plumbing</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Appliance">Appliance</option>
                    <option value="Carpentry / Joinery">Carpentry / Joinery</option>
                    <option value="Doors / Locks">Doors / Locks</option>
                    <option value="Painting">Painting</option>
                    <option value="General Maintenance">General Maintenance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="routine">Routine</option>
                    <option value="monitor">Monitor</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Description</label>
                <textarea
                  rows={2}
                  placeholder="Details regarding the maintenance finding..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Approved Work Instruction</label>
                <textarea
                  rows={2}
                  placeholder="Instructions for contractor/staff..."
                  value={newWorkInstruction}
                  onChange={(e) => setNewWorkInstruction(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
                >
                  Create Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaintenancePage;
