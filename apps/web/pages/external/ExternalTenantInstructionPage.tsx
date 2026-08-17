import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ImagePlus, ShieldAlert, UploadCloud } from 'lucide-react';
import type { TenantInstruction } from '../../types/platform';
import {
  getExternalTenantInstruction,
  submitExternalTenantResponse,
} from '../../services/platform/maintenanceService';
import { uploadExternalEvidence } from '../../services/platform/externalEvidenceUploadService';

const ExternalTenantInstructionPage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [instruction, setInstruction] = useState<TenantInstruction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responseNote, setResponseNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);

  useEffect(() => {
    if (!grantToken) return;
    getExternalTenantInstruction(grantToken)
      .then(setInstruction)
      .catch((err) => {
        console.error('Failed to load instruction', err);
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
      const ids: string[] = [];
      for (const file of files) ids.push((await uploadExternalEvidence(grantToken, file)).photoId);
      setEvidenceIds((current) => [...new Set([...current, ...ids])]);
      setUploadedNames((current) => [...current, ...files.map((file) => file.name)]);
    } catch (err) {
      console.error('Failed to upload tenant evidence', err);
      setError(err instanceof Error ? err.message : 'Evidence upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grantToken || (!responseNote.trim() && evidenceIds.length === 0)) return;
    try {
      setInstruction(await submitExternalTenantResponse(grantToken, responseNote.trim(), evidenceIds));
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit tenant response', err);
      setError(err instanceof Error ? err.message : 'Failed to submit response.');
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading instruction...</div>;
  if ((error && !instruction) || !instruction) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4"><div className="max-w-md w-full bg-white p-6 rounded-2xl border border-gray-200 text-center space-y-3"><ShieldAlert className="mx-auto text-red-500" size={32} /><h1 className="text-lg font-bold text-gray-900">Link Invalid or Expired</h1><p className="text-xs text-gray-500">{error || 'Unable to access instruction.'}</p></div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8 flex justify-center">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div className="border-b border-gray-100 pb-4 flex items-center justify-between"><div><div className="text-xs font-bold uppercase text-gray-400">ProInspect Tenant Portal</div><h1 className="text-lg font-bold text-gray-900 mt-1">{instruction.title}</h1></div><span className="rounded bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 uppercase capitalize">{instruction.status.replaceAll('_', ' ')}</span></div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        <div className="space-y-4 text-xs">
          <div><label className="font-semibold text-gray-700">Instruction:</label><p className="mt-1 text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">{instruction.instruction}</p></div>
          {instruction.dueDate && <div className="text-gray-600"><span className="font-semibold text-gray-700">Due date:</span> {new Date(instruction.dueDate).toLocaleDateString()}</div>}
          {submitted && <div className="rounded-lg bg-emerald-50 p-4 text-xs text-emerald-800 font-medium">Your response has been submitted to the property manager.</div>}

          {instruction.responseRequired && !['resolved', 'closed'].includes(instruction.status) && (
            <form onSubmit={handleSubmit} className="space-y-3 border-t border-gray-100 pt-4">
              <label className="block text-xs font-semibold text-gray-700">Tenant Response</label>
              <textarea rows={4} value={responseNote} onChange={(event) => setResponseNote(event.target.value)} placeholder="Provide the requested information or update..." className="w-full rounded-lg border border-gray-300 p-3 text-xs focus:border-gray-900 focus:outline-none" />
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4"><div className="flex items-start gap-3"><ImagePlus className="mt-0.5 text-gray-500" size={18} /><div className="flex-1"><div className="font-semibold text-gray-800">Supporting photographs</div><p className="mt-1 text-[11px] text-gray-500">Photographs are verified against their SHA-256 and exact Storage generation before the canonical evidence ID is linked to this response.</p><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-100"><UploadCloud size={15} />{uploading ? 'Uploading...' : 'Add Evidence'}<input className="hidden" type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple disabled={uploading} onChange={(event) => void handleEvidence(event)} /></label></div></div>{uploadedNames.length > 0 && <ul className="mt-3 space-y-1 text-[11px] text-emerald-700">{uploadedNames.map((name, index) => <li key={`${name}-${index}`}>Evidence verified: {name}</li>)}</ul>}</div>
              <button disabled={uploading || (!responseNote.trim() && evidenceIds.length === 0)} type="submit" className="w-full rounded-lg bg-gray-900 py-2.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">Submit Response</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExternalTenantInstructionPage;
