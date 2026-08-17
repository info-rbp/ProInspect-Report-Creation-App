import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ImagePlus, ShieldAlert, X } from 'lucide-react';
import type { MaintenanceItem, WorkRequest } from '../../types/platform';
import { uploadExternalEvidence } from '../../services/platform/externalEvidenceUploadService';
import { getExternalWorkRequest, submitExternalWorkResponse } from '../../services/platform/maintenanceService';

interface ExternalWorkRequestData {
  workRequest: WorkRequest;
  maintenanceItem: Partial<MaintenanceItem> | null;
  propertyAddress: string;
}

const ACCEPTED_EVIDENCE = '.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif';

const ExternalWorkRequestPage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [data, setData] = useState<ExternalWorkRequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!grantToken) return;
    getExternalWorkRequest(grantToken)
      .then(setData)
      .catch((err) => {
        console.error('Failed to load work request', err);
        setError('Invalid or expired access link.');
      })
      .finally(() => setLoading(false));
  }, [grantToken]);

  const handleAction = async (action: 'acknowledge' | 'in_progress' | 'complete' | 'unable_to_complete') => {
    if (!grantToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const completionEvidenceIds: string[] = [];
      if (action === 'complete') {
        for (const file of evidenceFiles) {
          const evidence = await uploadExternalEvidence(grantToken, file);
          completionEvidenceIds.push(evidence.photoId);
        }
      }
      await submitExternalWorkResponse(
        grantToken,
        action,
        notes,
        action === 'complete' ? completionEvidenceIds : undefined,
      );
      setSubmitted(true);
      if (action === 'complete') setEvidenceFiles([]);
      setData(await getExternalWorkRequest(grantToken));
    } catch (err) {
      console.error('Failed to submit contractor response', err);
      setError(err instanceof Error ? err.message : 'Failed to submit response.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading work request...</div>;
  }

  if ((error && !data) || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-2xl border border-gray-200 text-center space-y-3">
          <ShieldAlert className="mx-auto text-red-500" size={32} />
          <h1 className="text-lg font-bold text-gray-900">Access Restricted</h1>
          <p className="text-xs text-gray-500">{error || 'Unable to access work request.'}</p>
        </div>
      </div>
    );
  }

  const { workRequest, maintenanceItem, propertyAddress } = data;
  const canComplete = ['issued', 'acknowledged', 'in_progress'].includes(workRequest.status);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8 flex justify-center">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div className="border-b border-gray-100 pb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase text-gray-400">ProInspect Contractor Portal</div>
            <h1 className="text-lg font-bold text-gray-900 mt-1">Work Request #{workRequest.id.slice(0, 8)}</h1>
          </div>
          <span className="rounded bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 uppercase capitalize">
            {workRequest.status.replaceAll('_', ' ')}
          </span>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 p-4 text-xs space-y-2">
            <div>
              <span className="text-gray-400">Property Address:</span>
              <div className="font-semibold text-gray-900">{propertyAddress}</div>
            </div>
            {maintenanceItem?.title && (
              <div>
                <span className="text-gray-400">Task Title:</span>
                <div className="font-semibold text-gray-900">{maintenanceItem.title}</div>
              </div>
            )}
          </div>

          <div className="text-xs space-y-1">
            <label className="font-semibold text-gray-700">Instructions:</label>
            <p className="text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">{workRequest.instructions}</p>
          </div>

          {submitted && (
            <div className="rounded-lg bg-emerald-50 p-4 text-xs text-emerald-800 font-medium">
              Response submitted successfully.
            </div>
          )}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

          <div className="space-y-3 border-t border-gray-100 pt-4">
            <label className="block text-xs font-semibold text-gray-700">Contractor Notes & Progress Update</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Enter updates, completion details, or access notes..."
              className="w-full rounded-lg border border-gray-300 p-3 text-xs focus:border-gray-900 focus:outline-none"
            />

            {canComplete && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-700"><ImagePlus size={15} /> Completion evidence</div>
                <p className="mt-1 text-[11px] leading-4 text-gray-500">Optional image evidence is uploaded through the scoped access link and verified against its SHA-256 before it is attached to the completion response.</p>
                <input
                  type="file"
                  multiple
                  accept={ACCEPTED_EVIDENCE}
                  disabled={busy}
                  onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))}
                  className="mt-2 block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-gray-700"
                />
                {evidenceFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {evidenceFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-[11px] text-gray-600">
                        <span className="truncate">{file.name}</span>
                        <button type="button" disabled={busy} onClick={() => setEvidenceFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))} className="text-gray-400 hover:text-gray-700" title="Remove evidence"><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <button disabled={busy} onClick={() => void handleAction('acknowledge')} className="rounded-lg border border-gray-300 bg-white py-2 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50">Acknowledge Request</button>
              <button disabled={busy} onClick={() => void handleAction('in_progress')} className="rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">Mark In Progress</button>
              <button disabled={busy || !canComplete} onClick={() => void handleAction('complete')} className="rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Submitting...' : 'Submit Completion'}</button>
              <button disabled={busy} onClick={() => void handleAction('unable_to_complete')} className="rounded-lg bg-gray-700 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">Unable to Complete</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExternalWorkRequestPage;