import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ImagePlus, ShieldAlert, UploadCloud } from 'lucide-react';
import type { MaintenanceItem, WorkRequest } from '../../types/platform';
import {
  getExternalWorkRequest,
  submitExternalWorkResponse,
} from '../../services/platform/maintenanceService';
import { uploadExternalEvidence } from '../../services/platform/externalEvidenceUploadService';

interface ExternalWorkRequestData {
  workRequest: WorkRequest;
  maintenanceItem: Partial<MaintenanceItem> | null;
  propertyAddress: string;
}

const ExternalWorkRequestPage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [data, setData] = useState<ExternalWorkRequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);

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

  const handleEvidence = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!grantToken) return;
    const files = [...(event.target.files || [])].slice(0, 8);
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const result = await uploadExternalEvidence(grantToken, file);
        uploaded.push(result.photoId);
      }
      setEvidenceIds((current) => [...new Set([...current, ...uploaded])]);
      setUploadedNames((current) => [...current, ...files.map((file) => file.name)]);
    } catch (err) {
      console.error('Failed to upload contractor evidence', err);
      setError(err instanceof Error ? err.message : 'Evidence upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleAction = async (action: 'acknowledge' | 'in_progress' | 'complete' | 'unable_to_complete') => {
    if (!grantToken) return;
    try {
      await submitExternalWorkResponse(grantToken, action, notes, evidenceIds);
      setSubmitted(true);
      setData(await getExternalWorkRequest(grantToken));
    } catch (err) {
      console.error('Failed to submit contractor response', err);
      setError(err instanceof Error ? err.message : 'Failed to submit response.');
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading work request...</div>;

  if (error && !data) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4"><div className="max-w-md w-full bg-white p-6 rounded-2xl border border-gray-200 text-center space-y-3"><ShieldAlert className="mx-auto text-red-500" size={32} /><h1 className="text-lg font-bold text-gray-900">Access Restricted</h1><p className="text-xs text-gray-500">{error}</p></div></div>;
  }
  if (!data) return null;

  const { workRequest, maintenanceItem, propertyAddress } = data;
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8 flex justify-center">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div className="border-b border-gray-100 pb-4 flex items-center justify-between">
          <div><div className="text-xs font-bold uppercase text-gray-400">ProInspect Contractor Portal</div><h1 className="text-lg font-bold text-gray-900 mt-1">Work Request #{workRequest.id.slice(0, 8)}</h1></div>
          <span className="rounded bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 uppercase capitalize">{workRequest.status.replaceAll('_', ' ')}</span>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 p-4 text-xs space-y-2"><div><span className="text-gray-400">Property Address:</span><div className="font-semibold text-gray-900">{propertyAddress}</div></div>{maintenanceItem?.title && <div><span className="text-gray-400">Task Title:</span><div className="font-semibold text-gray-900">{maintenanceItem.title}</div></div>}</div>
          <div className="text-xs space-y-1"><label className="font-semibold text-gray-700">Instructions:</label><p className="text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">{workRequest.instructions}</p></div>
          {submitted && <div className="rounded-lg bg-emerald-50 p-4 text-xs text-emerald-800 font-medium">Response submitted successfully.</div>}

          <div className="space-y-3 border-t border-gray-100 pt-4">
            <label className="block text-xs font-semibold text-gray-700">Contractor Notes & Progress Update</label>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Enter updates, completion details, or access notes..." className="w-full rounded-lg border border-gray-300 p-3 text-xs focus:border-gray-900 focus:outline-none" />

            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
              <div className="flex items-start gap-3"><ImagePlus className="mt-0.5 text-gray-500" size={18} /><div className="flex-1"><div className="text-xs font-semibold text-gray-800">Completion photographs</div><p className="mt-1 text-[11px] text-gray-500">Upload JPEG, PNG, HEIC or HEIF evidence. Images are verified against their SHA-256 and exact Storage generation before the canonical photo ID is attached to this work request.</p><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-100"><UploadCloud size={15} />{uploading ? 'Uploading...' : 'Add Evidence'}<input className="hidden" type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple disabled={uploading} onChange={(event) => void handleEvidence(event)} /></label></div></div>
              {uploadedNames.length > 0 && <ul className="mt-3 space-y-1 text-[11px] text-emerald-700">{uploadedNames.map((name, index) => <li key={`${name}-${index}`}>Evidence verified: {name}</li>)}</ul>}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button disabled={uploading} onClick={() => void handleAction('acknowledge')} className="rounded-lg border border-gray-300 bg-white py-2 text-xs font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50">Acknowledge Request</button>
              <button disabled={uploading} onClick={() => void handleAction('in_progress')} className="rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">Mark In Progress</button>
              <button disabled={uploading} onClick={() => void handleAction('complete')} className="rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Submit Completion</button>
              <button disabled={uploading} onClick={() => void handleAction('unable_to_complete')} className="rounded-lg bg-gray-700 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">Unable to Complete</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExternalWorkRequestPage;
