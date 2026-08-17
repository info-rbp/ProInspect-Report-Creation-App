import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ImagePlus, ShieldAlert, X } from 'lucide-react';
import type { TenantInstruction } from '../../types/platform';
import { uploadExternalEvidence } from '../../services/platform/externalEvidenceUploadService';
import {
  getExternalTenantInstruction,
  submitExternalTenantResponse,
} from '../../services/platform/maintenanceService';

const ACCEPTED_EVIDENCE =
  '.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif';

const ExternalTenantInstructionPage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [instruction, setInstruction] = useState<TenantInstruction | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseNote, setResponseNote] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grantToken || !responseNote.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tenantEvidenceIds: string[] = [];
      for (const file of evidenceFiles) {
        const evidence = await uploadExternalEvidence(grantToken, file);
        tenantEvidenceIds.push(evidence.photoId);
      }
      setInstruction(
        await submitExternalTenantResponse(grantToken, responseNote.trim(), tenantEvidenceIds),
      );
      setEvidenceFiles([]);
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit tenant response', err);
      setError(err instanceof Error ? err.message : 'Failed to submit response.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
        Loading instruction...
      </div>
    );
  }

  if ((error && !instruction) || !instruction) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-2xl border border-gray-200 text-center space-y-3">
          <ShieldAlert className="mx-auto text-red-500" size={32} />
          <h1 className="text-lg font-bold text-gray-900">Link Invalid or Expired</h1>
          <p className="text-xs text-gray-500">{error || 'Unable to access instruction.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8 flex justify-center">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div className="border-b border-gray-100 pb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase text-gray-400">ProInspect Tenant Portal</div>
            <h1 className="text-lg font-bold text-gray-900 mt-1">{instruction.title}</h1>
          </div>
          <span className="rounded bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 uppercase capitalize">
            {instruction.status.replaceAll('_', ' ')}
          </span>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-gray-700">Instruction:</label>
            <p className="mt-1 text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">
              {instruction.instruction}
            </p>
          </div>
          {instruction.dueDate && (
            <div className="text-gray-600">
              <span className="font-semibold text-gray-700">Due date:</span>{' '}
              {new Date(instruction.dueDate).toLocaleDateString()}
            </div>
          )}

          {submitted && (
            <div className="rounded-lg bg-emerald-50 p-4 text-xs text-emerald-800 font-medium">
              Your response has been submitted to the property manager.
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {instruction.responseRequired &&
            instruction.status !== 'resolved' &&
            instruction.status !== 'closed' && (
              <form onSubmit={handleSubmit} className="space-y-3 border-t border-gray-100 pt-4">
                <label className="block text-xs font-semibold text-gray-700">Tenant Response</label>
                <textarea
                  rows={4}
                  required
                  value={responseNote}
                  onChange={(event) => setResponseNote(event.target.value)}
                  placeholder="Provide the requested information or update..."
                  className="w-full rounded-lg border border-gray-300 p-3 text-xs focus:border-gray-900 focus:outline-none"
                />

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center gap-2 font-semibold text-gray-700">
                    <ImagePlus size={15} /> Supporting photo evidence
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-gray-500">
                    Optional evidence is verified against its SHA-256 before the authoritative photo ID
                    is attached to your response.
                  </p>
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
                        <div
                          key={`${file.name}-${file.size}-${index}`}
                          className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-[11px] text-gray-600"
                        >
                          <span className="truncate">{file.name}</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setEvidenceFiles((files) =>
                                files.filter((_, fileIndex) => fileIndex !== index),
                              )
                            }
                            className="text-gray-400 hover:text-gray-700"
                            title="Remove evidence"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  disabled={busy}
                  type="submit"
                  className="w-full rounded-lg bg-gray-900 py-2.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {busy ? 'Uploading & Submitting...' : 'Submit Response'}
                </button>
              </form>
            )}
        </div>
      </div>
    </div>
  );
};

export default ExternalTenantInstructionPage;
