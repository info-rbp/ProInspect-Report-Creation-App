import React, { useEffect, useMemo, useState } from 'react';
import { FileSearch, RefreshCw, ShieldCheck } from 'lucide-react';
import { pcrStandardAreas } from '@pcr/templates';
import type {
  HistoricalExtractedFinding,
  PropertyDocument,
  PropertyDocumentAnalysisRecord,
  PropertyRecord,
} from '../../types/platform';
import { getProperty } from '../../services/platform/propertyService';
import {
  analyseHistoricalDocument,
  getHistoricalDocumentAnalysis,
  reviewHistoricalDocument,
  type HistoricalReviewDecision,
} from '../../services/platform/propertyIntelligenceService';

const REPORT_TYPES = new Set(['entry_report', 'routine_report', 'exit_report', 'maintenance_report', 'comparison_report']);

interface Props {
  propertyId: string;
}

const HistoricalImportIntelligencePanel: React.FC<Props> = ({ propertyId }) => {
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [analysis, setAnalysis] = useState<PropertyDocumentAnalysisRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProperty = async () => {
    const record = await getProperty(propertyId);
    setProperty(record || null);
    return record;
  };

  useEffect(() => {
    void loadProperty().catch((err) => setError(err instanceof Error ? err.message : 'Property could not be loaded.'));
  }, [propertyId]);

  const documents = useMemo(
    () => (property?.documents || []).filter((document) => REPORT_TYPES.has(document.type)),
    [property],
  );
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId);
  const components = useMemo(() => {
    const seen = new Set<string>();
    return pcrStandardAreas.flatMap((area) => area.components).filter((component) => {
      if (seen.has(component.id)) return false;
      seen.add(component.id);
      return true;
    });
  }, []);

  const selectDocument = async (document: PropertyDocument) => {
    setSelectedDocumentId(document.id);
    setAnalysis(null);
    setError(null);
    if (!property || document.status === 'local_only') return;
    setBusy(true);
    try {
      setAnalysis(await getHistoricalDocumentAnalysis(property, document.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Historical analysis could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const analyse = async (document: PropertyDocument) => {
    if (!property || document.status === 'local_only') return;
    setBusy(true);
    setError(null);
    try {
      const result = await analyseHistoricalDocument(property, document.id);
      setAnalysis(result);
      setSelectedDocumentId(document.id);
      await loadProperty();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Historical document analysis failed.');
    } finally {
      setBusy(false);
    }
  };

  const patchFinding = (findingId: string, patch: Partial<HistoricalExtractedFinding>) => {
    setAnalysis((current) => current ? {
      ...current,
      findings: current.findings.map((finding) => finding.id === findingId ? { ...finding, ...patch } : finding),
    } : current);
  };

  const saveReview = async () => {
    if (!property || !analysis || !selectedDocument) return;
    const decisions: HistoricalReviewDecision[] = analysis.findings
      .filter((finding) => finding.decision !== 'suggested')
      .map((finding) => ({
        findingId: finding.id,
        decision: finding.decision as HistoricalReviewDecision['decision'],
        ...(finding.proposedAreaId ? { proposedAreaId: finding.proposedAreaId } : {}),
        ...(finding.proposedComponentId ? { proposedComponentId: finding.proposedComponentId } : {}),
        ...(finding.reviewerNote ? { reviewerNote: finding.reviewerNote } : {}),
      }));
    if (!decisions.length) {
      setError('Review at least one extracted finding before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const freshProperty = await loadProperty();
      if (!freshProperty) throw new Error('Property could not be reloaded before review.');
      const result = await reviewHistoricalDocument(freshProperty, selectedDocument.id, analysis, decisions);
      setAnalysis(result);
      await loadProperty();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Historical mapping review could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!property || documents.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2">
            <FileSearch size={18} className="text-blue-600" />
            <h2 className="font-bold text-slate-950">Historical Report Intelligence</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Extract legacy report observations into review candidates. The source remains immutable and nothing becomes authoritative until a human confirms the mapping.
          </p>
        </div>
        <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-700">Human review required</span>
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {documents.map((document) => (
          <div
            key={document.id}
            role="button"
            tabIndex={0}
            onClick={() => void selectDocument(document)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') void selectDocument(document);
            }}
            className={`rounded-xl border p-3 text-left outline-none focus:ring-2 focus:ring-blue-500 ${selectedDocumentId === document.id ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{document.title}</div>
                <div className="mt-1 text-xs text-slate-500">{document.fileName} · {document.inspectionDate || 'date not recorded'}</div>
              </div>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">{document.importStatus || 'uploaded'}</span>
            </div>
            <div className="mt-3">
              <button
                type="button"
                disabled={busy || document.status === 'local_only'}
                onClick={(event) => {
                  event.stopPropagation();
                  void analyse(document);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {busy && selectedDocumentId === document.id ? <RefreshCw size={13} className="animate-spin" /> : <FileSearch size={13} />}
                {document.status === 'local_only' ? 'Cloud verification required' : 'Analyse historical report'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {analysis && selectedDocument && (
        <div className="mt-5 border-t border-slate-200 pt-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h3 className="font-bold text-slate-900">Extraction Review</h3>
              <p className="mt-1 max-w-4xl text-xs text-slate-600">{analysis.summary}</p>
              <div className="mt-2 text-[11px] text-slate-400">Model {analysis.model} · Prompt {analysis.promptVersion} · {analysis.findings.length} candidate(s)</div>
            </div>
            <button disabled={busy} onClick={() => void saveReview()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              <ShieldCheck size={15} /> Save Human Review
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[1100px] w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="border-b border-slate-200 px-2 py-2">Source</th>
                  <th className="border-b border-slate-200 px-2 py-2">Observation</th>
                  <th className="border-b border-slate-200 px-2 py-2">Suggested area</th>
                  <th className="border-b border-slate-200 px-2 py-2">Suggested component</th>
                  <th className="border-b border-slate-200 px-2 py-2">Confidence</th>
                  <th className="border-b border-slate-200 px-2 py-2">Decision</th>
                </tr>
              </thead>
              <tbody>
                {analysis.findings.map((finding) => (
                  <tr key={finding.id} className="align-top">
                    <td className="border-b border-slate-100 px-2 py-3">
                      <div className="font-semibold">{finding.sourceArea}</div>
                      <div className="text-slate-500">{finding.sourceComponent}{finding.sourcePage ? ` · p.${finding.sourcePage}` : ''}</div>
                    </td>
                    <td className="max-w-md border-b border-slate-100 px-2 py-3 text-slate-700">{finding.sourceCommentary}</td>
                    <td className="border-b border-slate-100 px-2 py-3">
                      <select value={finding.proposedAreaId || ''} onChange={(event) => patchFinding(finding.id, { proposedAreaId: event.target.value || undefined, decision: finding.decision === 'suggested' ? 'edited' : finding.decision })} className="w-full rounded-lg border border-slate-200 px-2 py-1.5">
                        <option value="">Unmapped</option>
                        {(property.roomsConfig || []).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                      </select>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-3">
                      <select value={finding.proposedComponentId || ''} onChange={(event) => patchFinding(finding.id, { proposedComponentId: event.target.value || undefined, decision: finding.decision === 'suggested' ? 'edited' : finding.decision })} className="w-full rounded-lg border border-slate-200 px-2 py-1.5">
                        <option value="">Unmapped</option>
                        {components.map((component) => <option key={component.id} value={component.id}>{component.name}</option>)}
                      </select>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-3">{Math.round(finding.confidence * 100)}%{finding.uncertainty ? <div className="mt-1 max-w-xs text-[10px] text-amber-700">{finding.uncertainty}</div> : null}</td>
                    <td className="border-b border-slate-100 px-2 py-3">
                      <select value={finding.decision} onChange={(event) => patchFinding(finding.id, { decision: event.target.value as HistoricalExtractedFinding['decision'] })} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-semibold">
                        <option value="suggested">Needs review</option>
                        <option value="confirmed">Confirm</option>
                        <option value="edited">Confirm edited mapping</option>
                        <option value="rejected">Reject</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};

export default HistoricalImportIntelligencePanel;
