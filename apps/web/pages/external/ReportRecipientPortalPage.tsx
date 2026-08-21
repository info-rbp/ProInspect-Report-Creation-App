import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileText, ImagePlus, Loader2, MessageSquare, ShieldCheck } from 'lucide-react';
import {
  acknowledgePublicReport,
  getPublicReportAccess,
  submitPublicReportResponse,
  type PublicReportAccessData,
} from '../../services/platform/reportOperationsService';
import { uploadExternalEvidence } from '../../services/platform/externalEvidenceUploadService';

interface ComponentResponseDraft {
  key: string;
  areaId: string;
  componentId: string;
  label: string;
  note: string;
}

const ReportRecipientPortalPage: React.FC = () => {
  const { grantToken = '' } = useParams<{ grantToken: string }>();
  const [data, setData] = useState<PublicReportAccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generalNote, setGeneralNote] = useState('');
  const [componentDrafts, setComponentDrafts] = useState<ComponentResponseDraft[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = async () => {
    if (!grantToken) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getPublicReportAccess(grantToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This report link could not be opened.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [grantToken]);

  const components = useMemo(() => data?.areas.flatMap((area) => area.components.map((component) => ({
    key: `${area.id}:${component.id}`,
    areaId: area.id,
    componentId: component.id,
    label: `${area.name} · ${component.component}`,
  }))) ?? [], [data]);

  const addComponentResponse = (key: string) => {
    const component = components.find((candidate) => candidate.key === key);
    if (!component || componentDrafts.some((draft) => draft.key === key)) return;
    setComponentDrafts((current) => [...current, { ...component, note: '' }]);
  };

  const acknowledge = async (type: 'reviewed' | 'agreed' | 'disagreed') => {
    setBusy(true);
    setError(null);
    try {
      await acknowledgePublicReport(grantToken, type);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Acknowledgement could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const result = await uploadExternalEvidence(grantToken, file);
        uploaded.push(result.photoId);
      }
      setEvidenceIds((current) => [...new Set([...current, ...uploaded])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Supporting evidence could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  const submitResponse = async (event: React.FormEvent) => {
    event.preventDefault();
    const comments = componentDrafts.filter((draft) => draft.note.trim()).map((draft) => ({
      areaId: draft.areaId,
      componentId: draft.componentId,
      note: draft.note.trim(),
    }));
    if (!generalNote.trim() && comments.length === 0 && evidenceIds.length === 0) {
      setError('Add a general note, component response or supporting photograph before submitting.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitPublicReportResponse(grantToken, {
        ...(generalNote.trim() ? { generalNote: generalNote.trim() } : {}),
        comments,
        evidencePhotoIds: evidenceIds,
      });
      setSubmitted(true);
      setGeneralNote('');
      setComponentDrafts([]);
      setEvidenceIds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your response could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-slate-50"><div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={18} className="animate-spin" /> Loading secure report...</div></div>;
  }

  if (!data) {
    return <div className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center text-sm text-rose-800 shadow-sm">{error || 'This report link is unavailable.'}</div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <main className="mx-auto max-w-5xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 shrink-0 text-emerald-600" size={22} />
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Secure Report Access</div>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">{data.report.propertyAddress}</h1>
              <p className="mt-1 text-sm text-slate-600">{data.report.reportType} · Inspection {data.report.inspectionDate || '-'}</p>
              <p className="mt-2 text-xs text-slate-500">Your responses are recorded against immutable Report Version {data.report.reportVersionId}. They do not alter the issued report.</p>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        {submitted && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={17} /> Response submitted for agency review.</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-bold text-slate-900">Acknowledgement</h2><p className="text-xs text-slate-500">Acknowledgement records what you did with this exact report version. It is not silently treated as agreement.</p></div>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => void acknowledge('reviewed')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Reviewed</button>
              <button disabled={busy} onClick={() => void acknowledge('agreed')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Agree</button>
              <button disabled={busy} onClick={() => void acknowledge('disagreed')} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Disagree / Respond</button>
            </div>
          </div>
          {data.acknowledgements.length > 0 && <div className="mt-3 text-xs text-slate-500">Recorded: {data.acknowledgements.map((item) => `${item.acknowledgementType} ${new Date(item.createdAt).toLocaleString()}`).join(' · ')}</div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><FileText size={18} /><h2 className="text-sm font-bold">Issued Inspection Findings</h2></div>
          <div className="mt-4 space-y-4">
            {data.areas.map((area) => (
              <div key={area.id} className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-bold text-slate-900">{area.name}</h3>
                {area.overallCommentary && <p className="mt-1 text-xs text-slate-600">{area.overallCommentary}</p>}
                <div className="mt-3 divide-y divide-slate-100">
                  {area.components.map((component) => (
                    <div key={component.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="font-semibold text-sm text-slate-800">{component.component}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span>Condition: {component.conditionCategory.replaceAll('_', ' ')}</span>
                        <span>Cleanliness: {component.cleanlinessCategory.replaceAll('_', ' ')}</span>
                        {component.workingStatus !== 'not_applicable' && <span>Working: {component.workingStatus.replaceAll('_', ' ')}</span>}
                      </div>
                      {component.commentary && <p className="mt-1 text-xs text-slate-700">{component.commentary}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <form onSubmit={submitResponse} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2"><MessageSquare size={18} /><h2 className="text-sm font-bold">Submit a Response</h2></div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">General comments</label>
            <textarea value={generalNote} onChange={(event) => setGeneralNote(event.target.value)} rows={4} className="w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Record any corrections, disagreements or additional observations." />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Respond to a specific component</label>
            <select defaultValue="" onChange={(event) => { addComponentResponse(event.target.value); event.currentTarget.value = ''; }} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select area / component...</option>
              {components.filter((component) => !componentDrafts.some((draft) => draft.key === component.key)).map((component) => <option key={component.key} value={component.key}>{component.label}</option>)}
            </select>
            <div className="mt-2 space-y-2">
              {componentDrafts.map((draft) => (
                <div key={draft.key} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3"><div className="text-xs font-bold text-slate-700">{draft.label}</div><button type="button" onClick={() => setComponentDrafts((current) => current.filter((item) => item.key !== draft.key))} className="text-xs font-semibold text-rose-700">Remove</button></div>
                  <textarea value={draft.note} onChange={(event) => setComponentDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, note: event.target.value } : item))} rows={2} className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Your comment about this component" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Supporting photographs</label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
              {uploading ? 'Uploading & verifying...' : 'Upload evidence'}
              <input type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple disabled={uploading || busy} onChange={(event) => void uploadFiles(event.target.files)} className="hidden" />
            </label>
            {evidenceIds.length > 0 && <div className="mt-2 text-xs text-emerald-700">{evidenceIds.length} verified evidence file{evidenceIds.length === 1 ? '' : 's'} attached.</div>}
          </div>

          <button disabled={busy || uploading} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Submit Response
          </button>
        </form>

        {data.responses.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold">Submitted Responses</h2>
            <div className="mt-3 space-y-2">{data.responses.map((response) => <div key={response.id} className="rounded-lg border border-slate-200 p-3"><div className="text-xs font-bold uppercase text-slate-500">{response.status}</div><div className="mt-1 text-sm text-slate-700">{response.generalNote || `${response.comments.length} component comment(s)`}</div><div className="mt-1 text-[11px] text-slate-500">Submitted {new Date(response.submittedAt).toLocaleString()} · Evidence {response.evidencePhotoIds.length}</div></div>)}</div>
          </section>
        )}
      </main>
    </div>
  );
};

export default ReportRecipientPortalPage;
