import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Folder,
  Layers,
  ShoppingBag,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import type { InspectionJob, InspectionJobStatus, InspectionReportType, PropertyRecord } from '../../types/platform';
import { INSPECTION_REPORT_TYPES } from '../../types/platform';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';

interface InspectionJobFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (jobData: Partial<InspectionJob>) => Promise<void>;
  properties: PropertyRecord[];
  initialJob?: InspectionJob | null;
}

const PRESET_INSPECTORS = [
  'David Taylor (Senior Inspector)',
  'Emily Watson (Field Inspector)',
  'James Bond (Property Analyst)',
  'Alex Rivera (Operations Specialist)',
];

const PRESET_REVIEWERS = [
  'Sarah Connor (Review Manager)',
  'Michael Scott (Operations Lead)',
  'Amanda Waller (Quality Control)',
];

const STATUS_OPTIONS: { value: InspectionJobStatus; label: string; group: string }[] = [
  { value: 'draft', label: 'Draft', group: 'Planning' },
  { value: 'booked', label: 'Booked / Scheduled', group: 'Planning' },
  { value: 'assigned', label: 'Assigned to Inspector', group: 'Planning' },
  { value: 'inspection_started', label: 'Inspection In Progress', group: 'Field Work' },
  { value: 'photos_uploading', label: 'Photos Uploading', group: 'Field Work' },
  { value: 'photos_uploaded', label: 'Photos Uploaded', group: 'Field Work' },
  { value: 'inspection_submitted', label: 'Inspection Submitted', group: 'Field Work' },
  { value: 'analysis_running', label: 'AI Analysis Running', group: 'Analysis & Review' },
  { value: 'review_required', label: 'Review Required', group: 'Analysis & Review' },
  { value: 'reviewer_approved', label: 'Reviewer Approved', group: 'Analysis & Review' },
  { value: 'ready_to_issue', label: 'Ready to Issue', group: 'Finalisation' },
  { value: 'issued_to_tenant', label: 'Issued to Tenant', group: 'Finalisation' },
  { value: 'finalised', label: 'Finalised / Completed', group: 'Finalisation' },
  { value: 'on_hold', label: 'On Hold', group: 'Exceptions' },
  { value: 'cancelled', label: 'Cancelled', group: 'Exceptions' },
];

export const InspectionJobFormModal: React.FC<InspectionJobFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  properties,
  initialJob,
}) => {
  const [propertyId, setPropertyId] = useState('');
  const [reportType, setReportType] = useState<InspectionReportType>('Property Condition Report');
  const [status, setStatus] = useState<InspectionJobStatus>('booked');
  const [scheduledAt, setScheduledAt] = useState('');
  const [assignedInspectorId, setAssignedInspectorId] = useState('');
  const [assignedReviewerId, setAssignedReviewerId] = useState('');
  const [tenancyId, setTenancyId] = useState('');
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState('');
  const [shopifyOrderId, setShopifyOrderId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialJob) {
      setPropertyId(initialJob.propertyId || '');
      setReportType(initialJob.reportType || 'Property Condition Report');
      setStatus(initialJob.status || 'booked');
      setScheduledAt(
        initialJob.scheduledAt
          ? new Date(initialJob.scheduledAt).toISOString().slice(0, 16)
          : ''
      );
      setAssignedInspectorId(initialJob.assignedInspectorId || '');
      setAssignedReviewerId(initialJob.assignedReviewerId || '');
      setTenancyId(initialJob.tenancyId || '');
      setGoogleDriveFolderId(initialJob.googleDriveFolderId || '');
      setShopifyOrderId(initialJob.shopifyOrderId || '');
      setNotes(initialJob.notes || '');
    } else {
      setPropertyId(properties[0]?.id || '');
      setReportType('Property Condition Report');
      setStatus('booked');
      setScheduledAt('');
      setAssignedInspectorId('');
      setAssignedReviewerId('');
      setTenancyId('');
      setGoogleDriveFolderId('');
      setShopifyOrderId('');
      setNotes('');
    }
  }, [initialJob, properties, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) {
      setError('Please select a property for this inspection job.');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      await onSave({
        agencyId: initialJob?.agencyId || DEFAULT_AGENCY_ID,
        propertyId,
        reportType,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        assignedInspectorId: assignedInspectorId.trim() || undefined,
        assignedReviewerId: assignedReviewerId.trim() || undefined,
        tenancyId: tenancyId.trim() || undefined,
        googleDriveFolderId: googleDriveFolderId.trim() || undefined,
        shopifyOrderId: shopifyOrderId.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save inspection job.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {initialJob ? 'Edit Inspection Job' : 'Schedule New Inspection Job'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure job parameters, property linkage, and team assignments.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl bg-rose-50 p-3.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Property Selector */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Building className="h-3.5 w-3.5 text-blue-500" />
                Target Property <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              >
                <option value="">-- Select a Property --</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address} {p.suburb ? `(${p.suburb}, ${p.state})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Report Type */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <FileText className="h-3.5 w-3.5 text-emerald-500" />
                Report Type
              </label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as InspectionReportType)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              >
                {INSPECTION_REPORT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Scheduled Date & Time */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                Scheduled Date & Time
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Layers className="h-3.5 w-3.5 text-indigo-500" />
                Workflow Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InspectionJobStatus)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    [{opt.group}] {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Tenancy ID */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <UserCheck className="h-3.5 w-3.5 text-purple-500" />
                Tenancy Reference ID
              </label>
              <input
                type="text"
                placeholder="e.g. TEN-2025-0819"
                value={tenancyId}
                onChange={(e) => setTenancyId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            {/* Assigned Inspector */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <UserCheck className="h-3.5 w-3.5 text-cyan-500" />
                Assigned Inspector
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="inspectors-list"
                  placeholder="Select or enter inspector name"
                  value={assignedInspectorId}
                  onChange={(e) => setAssignedInspectorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
                />
                <datalist id="inspectors-list">
                  {PRESET_INSPECTORS.map((insp) => (
                    <option key={insp} value={insp} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Assigned Reviewer */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <UserX className="h-3.5 w-3.5 text-teal-500" />
                Assigned Reviewer
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="reviewers-list"
                  placeholder="Select or enter reviewer name"
                  value={assignedReviewerId}
                  onChange={(e) => setAssignedReviewerId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
                />
                <datalist id="reviewers-list">
                  {PRESET_REVIEWERS.map((rev) => (
                    <option key={rev} value={rev} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Google Drive Folder ID */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <Folder className="h-3.5 w-3.5 text-amber-500" />
                Google Drive Folder ID
              </label>
              <input
                type="text"
                placeholder="e.g. 1A2b3C4d5E6f7G8h"
                value={googleDriveFolderId}
                onChange={(e) => setGoogleDriveFolderId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            {/* Shopify Order ID */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <ShoppingBag className="h-3.5 w-3.5 text-emerald-500" />
                Shopify Order Reference
              </label>
              <input
                type="text"
                placeholder="e.g. SHP-98421"
                value={shopifyOrderId}
                onChange={(e) => setShopifyOrderId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            {/* Job Notes */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                Special Instructions & Notes
              </label>
              <textarea
                rows={3}
                placeholder="Add entry instructions, key lockbox codes, tenant notifications or field notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !propertyId}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? (
                <span>Saving...</span>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{initialJob ? 'Update Job' : 'Schedule Job'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
