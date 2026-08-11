import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, Hammer, Plus, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import type { MaintenanceCandidate, MaintenanceCategory, MaintenanceItem, MaintenancePriority } from '../../types/platform';
import {
  confirmMaintenanceCandidate,
  createMaintenanceItem,
  dismissMaintenanceCandidate,
  listMaintenanceCandidates,
  listMaintenanceItems,
} from '../../services/platform/maintenanceService';
import { Link } from 'react-router-dom';

const MaintenancePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'items' | 'candidates'>('items');
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [candidates, setCandidates] = useState<MaintenanceCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPropertyId, setNewPropertyId] = useState('');
  const [newCategory, setNewCategory] = useState<MaintenanceCategory>('General Maintenance');
  const [newPriority, setNewPriority] = useState<MaintenancePriority>('routine');
  const [newDescription, setNewDescription] = useState('');
  const [newWorkInstruction, setNewWorkInstruction] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextItems, nextCandidates] = await Promise.all([
        listMaintenanceItems(),
        listMaintenanceCandidates(),
      ]);
      setItems(nextItems);
      setCandidates(nextCandidates);
    } catch (err) {
      console.error('Failed to load maintenance data', err);
      setError('Could not load the maintenance queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const filteredItems = useMemo(() => items.filter((item) => {
    const query = searchTerm.toLowerCase();
    const matchesSearch = !query || [item.title, item.description, item.category, item.propertyId]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query));
    const matchesStatus = selectedStatus === 'all' || item.status === selectedStatus;
    const matchesPriority = selectedPriority === 'all' || item.priority === selectedPriority;
    return matchesSearch && matchesStatus && matchesPriority;
  }), [items, searchTerm, selectedStatus, selectedPriority]);

  const pendingCandidates = candidates.filter((candidate) => candidate.reviewStatus === 'suggested');

  const handleConfirmCandidate = async (candidateId: string) => {
    try {
      await confirmMaintenanceCandidate(candidateId);
      await fetchData();
    } catch (err) {
      console.error('Failed to confirm maintenance candidate', err);
      alert('Failed to confirm maintenance candidate.');
    }
  };

  const handleDismissCandidate = async (candidate: MaintenanceCandidate) => {
    const reason = window.prompt('Reason for dismissing this candidate:');
    if (!reason?.trim()) return;
    try {
      await dismissMaintenanceCandidate(candidate.id, reason.trim(), candidate.version || 1);
      await fetchData();
    } catch (err) {
      console.error('Failed to dismiss maintenance candidate', err);
      alert('Failed to dismiss maintenance candidate.');
    }
  };

  const handleCreateItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim() || !newPropertyId.trim()) return;
    try {
      await createMaintenanceItem({
        propertyId: newPropertyId.trim(),
        title: newTitle.trim(),
        category: newCategory,
        priority: newPriority,
        description: newDescription.trim(),
        workInstruction: newWorkInstruction.trim() || undefined,
        status: 'triage_required',
      });
      setShowCreateModal(false);
      setNewTitle('');
      setNewDescription('');
      setNewWorkInstruction('');
      await fetchData();
    } catch (err) {
      console.error('Failed to create maintenance item', err);
      alert('Failed to create maintenance item.');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Operations</h1>
          <p className="text-sm text-gray-500">Triage inspection findings, coordinate work and verify completion without altering the source report.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void fetchData()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><RefreshCw size={16} /> Refresh</button>
          <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"><Plus size={16} /> New Maintenance Item</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={<AlertTriangle size={20} />} label="Pending Triage" value={pendingCandidates.length} />
        <Metric icon={<ShieldAlert size={20} />} label="Urgent / High" value={items.filter((item) => item.priority === 'urgent' || item.priority === 'high').length} />
        <Metric icon={<Clock size={20} />} label="In Progress" value={items.filter((item) => item.status === 'assigned' || item.status === 'in_progress').length} />
        <Metric icon={<CheckCircle size={20} />} label="Needs Verification" value={items.filter((item) => item.status === 'verification_required').length} />
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <button onClick={() => setActiveTab('items')} className={`border-b-2 px-1 py-3 text-sm font-medium ${activeTab === 'items' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}>Maintenance Items ({items.length})</button>
          <button onClick={() => setActiveTab('candidates')} className={`border-b-2 px-1 py-3 text-sm font-medium ${activeTab === 'candidates' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}>Candidates ({pendingCandidates.length})</button>
        </nav>
      </div>

      {activeTab === 'items' ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="relative min-w-64 flex-1">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search maintenance..." className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" />
            </label>
            <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="all">All statuses</option>
              <option value="triage_required">Triage Required</option>
              <option value="approved">Approved</option>
              <option value="assigned">Assigned</option>
              <option value="in_progress">In Progress</option>
              <option value="verification_required">Verification Required</option>
              <option value="closed">Closed</option>
            </select>
            <select value={selectedPriority} onChange={(event) => setSelectedPriority(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="all">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="routine">Routine</option>
              <option value="monitor">Monitor</option>
            </select>
          </div>

          {loading ? <Loading /> : filteredItems.length === 0 ? <Empty text="No maintenance items match the current filters." /> : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Property</th><th className="px-4 py-3 text-right">Open</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3"><div className="font-medium text-gray-900">{item.title}</div><div className="text-xs text-gray-500">{item.category}</div></td>
                      <td className="px-4 py-3 capitalize">{item.priority}</td>
                      <td className="px-4 py-3 capitalize">{item.status.replaceAll('_', ' ')}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{item.propertyId}</td>
                      <td className="px-4 py-3 text-right"><Link to={`/app/admin/maintenance/${item.id}`} className="font-medium text-blue-600 hover:underline">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        loading ? <Loading /> : pendingCandidates.length === 0 ? <Empty text="No maintenance candidates are awaiting review." /> : (
          <div className="grid gap-3">
            {pendingCandidates.map((candidate) => (
              <div key={candidate.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900">{candidate.title}</div>
                    <div className="mt-1 text-xs text-gray-500">{candidate.description}</div>
                    <div className="mt-2 text-xs text-gray-400">{candidate.category} · {candidate.suggestedPriority} · source: {candidate.source}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => void handleConfirmCandidate(candidate.id)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white">Confirm</button>
                    <button onClick={() => void handleDismissCandidate(candidate)} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700">Dismiss</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">New Maintenance Item</h2>
            <form onSubmit={handleCreateItem} className="mt-4 space-y-3">
              <input required value={newPropertyId} onChange={(event) => setNewPropertyId(event.target.value)} placeholder="Property ID" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <input required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Issue title" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Observed issue" rows={3} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <textarea value={newWorkInstruction} onChange={(event) => setNewWorkInstruction(event.target.value)} placeholder="Approved work instruction (optional)" rows={2} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <select value={newCategory} onChange={(event) => setNewCategory(event.target.value as MaintenanceCategory)} className="rounded-lg border border-gray-300 p-2 text-sm"><option>General Maintenance</option><option>Plumbing</option><option>Electrical</option><option>Appliance</option><option>Cleaning</option><option>Safety</option></select>
                <select value={newPriority} onChange={(event) => setNewPriority(event.target.value as MaintenancePriority)} className="rounded-lg border border-gray-300 p-2 text-sm"><option value="routine">Routine</option><option value="high">High</option><option value="urgent">Urgent</option><option value="monitor">Monitor</option></select>
              </div>
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowCreateModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button><button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({ icon, label, value }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between text-gray-500"><span className="text-xs font-semibold uppercase tracking-wide">{label}</span>{icon}</div><div className="mt-2 text-2xl font-bold text-gray-900">{value}</div></div>
);
const Loading = () => <div className="p-8 text-center text-sm text-gray-500">Loading maintenance data...</div>;
const Empty: React.FC<{ text: string }> = ({ text }) => <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">{text}</div>;

export default MaintenancePage;
