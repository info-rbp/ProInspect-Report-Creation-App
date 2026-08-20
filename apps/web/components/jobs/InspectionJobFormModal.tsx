import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building,
  Calendar,
  Clock,
  FileText,
  KeyRound,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  InspectionAccessStatus,
  InspectionJob,
  InspectionPriority,
  InspectionReportType,
  PropertyRecord,
  UserProfile,
} from '../../types/platform';
import { INSPECTION_REPORT_TYPES } from '../../types/platform';
import {
  listAvailableInspectors,
  listAvailableReviewers,
} from '../../services/platform/userDirectoryService';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';

interface InspectionJobFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (jobData: Partial<InspectionJob>) => Promise<void>;
  properties: PropertyRecord[];
  initialJob?: InspectionJob | null;
}

function displayName(user: UserProfile): string {
  return user.displayName?.trim() || user.email;
}

function toLocalDateTime(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export const InspectionJobFormModal: React.FC<InspectionJobFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  properties,
  initialJob,
}) => {
  const [propertyId, setPropertyId] = useState('');
  const [reportType, setReportType] = useState<InspectionReportType>('Property Condition Report');
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [timezone, setTimezone] = useState('Australia/Perth');
  const [priority, setPriority] = useState<InspectionPriority>('normal');
  const [accessStatus, setAccessStatus] = useState<InspectionAccessStatus>('unknown');
  const [assignedInspectorId, setAssignedInspectorId] = useState('');
  const [assignedReviewerId, setAssignedReviewerId] = useState('');
  const [tenancyId, setTenancyId] = useState('');
  const [notes, setNotes] = useState('');
  const [inspectors, setInspectors] = useState<UserProfile[]>([]);
  const [reviewers, setReviewers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    void Promise.all([listAvailableInspectors(), listAvailableReviewers()])
      .then(([nextInspectors, nextReviewers]) => {
        setInspectors(nextInspectors);
        setReviewers(nextReviewers);
      })
      .catch(() => {
        setInspectors([]);
        setReviewers([]);
      });
    if (initialJob) {
      setPropertyId(initialJob.propertyId || '');
      setReportType(initialJob.reportType || 'Property Condition Report');
      setScheduledAt(toLocalDateTime(initialJob.scheduledAt));
      setDurationMinutes(initialJob.durationMinutes || 60);
      setTimezone(initialJob.timezone || 'Australia/Perth');
      setPriority(initialJob.priority || 'normal');
      setAccessStatus(initialJob.accessStatus || 'unknown');
      setAssignedInspectorId(initialJob.assignedInspectorId || '');
      setAssignedReviewerId(initialJob.assignedReviewerId || '');
      setTenancyId(initialJob.tenancyId || '');
      setNotes(initialJob.notes || '');
    } else {
      setPropertyId(properties[0]?.id || '');
      setReportType('Property Condition Report');
      setScheduledAt('');
      setDurationMinutes(60);
      setTimezone('Australia/Perth');
      setPriority('normal');
      setAccessStatus('unknown');
      setAssignedInspectorId('');
      setAssignedReviewerId('');
      setTenancyId('');
      setNotes('');
    }
    setError(null);
  }, [initialJob, isOpen, properties]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!propertyId) return setError('Select a property for this inspection job.');
    setLoading(true);
    setError(null);
    try {
      const startAt = scheduledAt ? new Date(scheduledAt).toISOString() : undefined;
      const endAt = startAt
        ? new Date(Date.parse(startAt) + Math.max(1, durationMinutes) * 60_000).toISOString()
        : undefined;
      await onSave({
        agencyId: initialJob?.agencyId || DEFAULT_AGENCY_ID,
        propertyId,
        reportType,
        scheduledAt: startAt,
        scheduledEndAt: endAt,
        durationMinutes: Math.max(1, durationMinutes),
        timezone,
        priority,
        accessStatus,
        assignedInspectorId: assignedInspectorId || undefined,
        assignedReviewerId: assignedReviewerId || undefined,
        tenancyId: tenancyId.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Inspection job could not be saved.');
    } finally {
      setLoading(false);
    }
  };

  const field = 'w-full rounded-xl border border-slate-200 bg-slate-50/40 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Calendar size={20} /></div>
            <div>
              <h2 className="font-bold text-slate-950">{initialJob ? 'Edit Inspection Job' : 'Create Manual Inspection Job'}</h2>
              <p className="text-xs text-slate-500">External orders and bookings are created through the Intake Queue; this form is for manual operational work.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </header>

        {error && <div className="mx-6 mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><AlertCircle size={15} /> {error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2 text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><Building size={14} /> Property</span><select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className={field}><option value="">Select property...</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}{property.suburb ? `, ${property.suburb}` : ''}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><FileText size={14} /> Inspection type</span><select value={reportType} onChange={(event) => setReportType(event.target.value as InspectionReportType)} className={field}>{INSPECTION_REPORT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><Clock size={14} /> Scheduled date and time</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className={field} /></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><Clock size={14} /> Duration in minutes</span><input type="number" min={1} step={15} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value) || 60)} className={field} /></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><Calendar size={14} /> Timezone</span><select value={timezone} onChange={(event) => setTimezone(event.target.value)} className={field}><option value="Australia/Perth">Australia/Perth</option><option value="Australia/Adelaide">Australia/Adelaide</option><option value="Australia/Brisbane">Australia/Brisbane</option><option value="Australia/Sydney">Australia/Sydney</option><option value="Australia/Melbourne">Australia/Melbourne</option><option value="Australia/Hobart">Australia/Hobart</option><option value="Australia/Darwin">Australia/Darwin</option></select></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><ShieldCheck size={14} /> Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as InspectionPriority)} className={field}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><KeyRound size={14} /> Access readiness</span><select value={accessStatus} onChange={(event) => setAccessStatus(event.target.value as InspectionAccessStatus)} className={field}><option value="unknown">Unknown</option><option value="instructions_available">Instructions available</option><option value="confirmation_requested">Confirmation requested</option><option value="confirmed">Confirmed</option><option value="not_required">Not required</option><option value="unable_to_access">Unable to access</option></select></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><UserCheck size={14} /> Inspector</span><select value={assignedInspectorId} onChange={(event) => setAssignedInspectorId(event.target.value)} className={field}><option value="">Unassigned</option>{inspectors.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><Users size={14} /> Reviewer</span><select value={assignedReviewerId} onChange={(event) => setAssignedReviewerId(event.target.value)} className={field}><option value="">Unassigned</option>{reviewers.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-1.5"><Users size={14} /> Tenancy reference</span><input value={tenancyId} onChange={(event) => setTenancyId(event.target.value)} placeholder="Optional tenancy ID" className={field} /></label>
            <label className="md:col-span-2 text-xs font-semibold text-slate-700">Operational notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} className={`${field} mt-1.5 resize-y`} placeholder="Access, preparation and inspection instructions..." /></label>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Cancel</button>
            <button disabled={loading} type="submit" className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white disabled:opacity-50">{loading ? 'Saving...' : initialJob ? 'Save Job' : 'Create Job'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
