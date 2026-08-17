import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Archive, CheckCircle2, Edit2, FileCheck2, Loader2, Printer, TriangleAlert } from 'lucide-react';
import PDFPreview from '../../components/PDFPreview';
import type { ReportData } from '../../types';
import { loadReportFromDB } from '../../services/storageService';
import { archiveFinalisedReport } from '../../services/platform/archiveService';
import {
  getPdfJob,
  queueFinalPdf,
  type PdfJobRecord,
} from '../../services/platform/pdfJobService';
import {
  getReportWorkflowRecord,
  transitionReportLifecycle,
  type ReportWorkflowRecord,
} from '../../services/platform/reportWorkflowService';

interface PreviewLocationState {
  report?: ReportData;
}

function sha256(value?: string): boolean {
  return Boolean(value && /^[a-f0-9]{64}$/iu.test(value));
}

const ReportPreviewPage: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const state = location.state as PreviewLocationState | null;
  const [report, setReport] = useState<ReportData | null>(state?.report || null);
  const [isLoading, setIsLoading] = useState(!state?.report);
  const [pdfJob, setPdfJob] = useState<PdfJobRecord | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [isQueueingPdf, setIsQueueingPdf] = useState(false);
  const [isFinalising, setIsFinalising] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const applyWorkflowRecord = useCallback((record: ReportWorkflowRecord) => {
    setReport((current) => current ? { ...current, ...record } : current);
  }, []);

  const refreshWorkflowRecord = useCallback(async (): Promise<ReportWorkflowRecord | undefined> => {
    if (!report?.agencyId || !report.id) return undefined;
    const latest = await getReportWorkflowRecord(report.agencyId, report.id);
    applyWorkflowRecord(latest);
    return latest;
  }, [applyWorkflowRecord, report?.agencyId, report?.id]);

  useEffect(() => {
    const loadReport = async () => {
      if (state?.report || !reportId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        setReport((await loadReportFromDB(reportId)) || null);
      } finally {
        setIsLoading(false);
      }
    };

    void loadReport();
  }, [reportId, state?.report]);

  useEffect(() => {
    if (!report?.agencyId || !report.id) return;
    void refreshWorkflowRecord().catch((error) => {
      setLifecycleError(error instanceof Error ? error.message : 'Report lifecycle could not be refreshed.');
    });
  }, [refreshWorkflowRecord, report?.agencyId, report?.id]);

  useEffect(() => {
    if (!pdfJob || !report?.agencyId || !['queued', 'running'].includes(pdfJob.status)) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await getPdfJob(report.agencyId!, pdfJob.id);
        if (cancelled) return;
        setPdfJob(latest);
        if (latest.status === 'failed') {
          setPdfError(latest.errorMessage || 'Final PDF generation failed.');
        } else if (latest.status === 'superseded') {
          setPdfError('This PDF job was superseded by a newer immutable report version. Queue a new final PDF.');
        } else if (latest.status === 'completed') {
          setPdfError(null);
          await refreshWorkflowRecord();
        }
      } catch (error) {
        if (!cancelled) {
          setPdfError(error instanceof Error ? error.message : 'Final PDF status could not be refreshed.');
        }
      }
    };

    const interval = window.setInterval(() => void poll(), 2_000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pdfJob?.id, pdfJob?.status, refreshWorkflowRecord, report?.agencyId]);

  const handleGenerateFinalPdf = async () => {
    if (!report) return;
    setIsQueueingPdf(true);
    setPdfError(null);
    setLifecycleError(null);
    try {
      const latest = await refreshWorkflowRecord();
      const authoritativeReport = latest ? { ...report, ...latest } : report;
      const job = await queueFinalPdf(authoritativeReport);
      setPdfJob(job);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Final PDF generation could not be queued.');
    } finally {
      setIsQueueingPdf(false);
    }
  };

  const handleFinalise = async () => {
    if (!report?.agencyId) return;
    setIsFinalising(true);
    setLifecycleError(null);
    try {
      const latest = await getReportWorkflowRecord(report.agencyId, report.id);
      if (latest.lifecycleStatus !== 'finalisation_ready') {
        throw new Error('The report is no longer finalisation ready. Refresh the workflow before retrying.');
      }
      const finalised = await transitionReportLifecycle(
        report.agencyId,
        report.id,
        'finalised',
        latest.version,
      );
      applyWorkflowRecord(finalised);
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : 'The report could not be finalised.');
    } finally {
      setIsFinalising(false);
    }
  };

  const handleArchive = async () => {
    if (!report?.agencyId) return;
    setIsArchiving(true);
    setLifecycleError(null);
    try {
      const latest = await getReportWorkflowRecord(report.agencyId, report.id);
      if (latest.lifecycleStatus !== 'finalised') {
        throw new Error('Only a finalised report can be archived. Refresh the workflow before retrying.');
      }
      const result = await archiveFinalisedReport(
        report.agencyId,
        report.id,
        latest.version,
      );
      setReport((current) => current ? {
        ...current,
        ...result.archivedReport,
        archiveReportVersionId: result.artifact.reportVersionId,
        archiveManifestObjectPath: result.artifact.objectPath,
        archiveManifestSha256: result.artifact.sha256,
        archiveCreatedAt: result.artifact.createdAt,
      } : current);
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : 'The report could not be archived.');
    } finally {
      setIsArchiving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-600 text-white">
        <div className="flex items-center gap-2">
          <Loader2 className="animate-spin" size={20} /> Loading preview...
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-950">Report not found</h1>
          <Link
            to="/app/admin/reports"
            className="mt-4 inline-flex rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to reports
          </Link>
        </div>
      </div>
    );
  }

  const finalPdfReady = report.lifecycleStatus === 'finalisation_ready' && Boolean(report.currentVersionId);
  const storedPdfForCurrentVersion = Boolean(
    report.currentVersionId &&
    report.finalPdfReportVersionId === report.currentVersionId &&
    report.finalPdfObjectPath &&
    report.finalPdfGeneration &&
    sha256(report.finalPdfSha256) &&
    report.renderManifestObjectPath &&
    sha256(report.renderManifestSha256),
  );
  const archiveForCurrentVersion = Boolean(
    report.currentVersionId &&
    report.archiveReportVersionId === report.currentVersionId &&
    report.archiveManifestObjectPath &&
    sha256(report.archiveManifestSha256) &&
    report.archiveCreatedAt,
  );
  const finalPdfTitle = !report.currentVersionId
    ? 'An immutable report version must exist first.'
    : report.lifecycleStatus !== 'finalisation_ready'
      ? 'Resolve the issue/tenant response workflow and move the report to finalisation ready first.'
      : undefined;
  const pdfActive = pdfJob?.status === 'queued' || pdfJob?.status === 'running';
  const pdfCompleted = pdfJob?.status === 'completed';
  const pdfFailed = pdfJob?.status === 'failed' || pdfJob?.status === 'superseded';
  const generateDisabled = isQueueingPdf || !finalPdfReady || pdfActive || storedPdfForCurrentVersion;
  const canFinalise = report.lifecycleStatus === 'finalisation_ready' && storedPdfForCurrentVersion;
  const canArchive = report.lifecycleStatus === 'finalised';

  const buttonLabel = isQueueingPdf
    ? 'Queueing Final PDF...'
    : pdfJob?.status === 'queued'
      ? 'Final PDF Queued'
      : pdfJob?.status === 'running'
        ? 'Generating Final PDF...'
        : storedPdfForCurrentVersion
          ? 'Final PDF Stored'
          : pdfFailed
            ? 'Retry Final PDF'
            : 'Generate Final PDF';

  return (
    <div className="min-h-screen bg-gray-600 py-8 print:bg-white print:p-0 print:m-0 print:h-auto print:w-full">
      <div className="fixed top-4 right-4 flex max-w-[calc(100vw-2rem)] flex-wrap justify-end gap-3 no-print z-50">
        <button
          onClick={() => window.print()}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium"
        >
          <Printer size={20} /> Print / Save PDF
        </button>
        <button
          onClick={handleGenerateFinalPdf}
          disabled={generateDisabled}
          title={finalPdfTitle}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800/70 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium"
        >
          {isQueueingPdf || pdfActive ? (
            <Loader2 size={20} className="animate-spin" />
          ) : storedPdfForCurrentVersion ? (
            <CheckCircle2 size={20} />
          ) : pdfFailed ? (
            <TriangleAlert size={20} />
          ) : (
            <FileCheck2 size={20} />
          )}
          {buttonLabel}
        </button>
        {report.lifecycleStatus === 'finalisation_ready' && (
          <button
            onClick={handleFinalise}
            disabled={!canFinalise || isFinalising}
            title={!storedPdfForCurrentVersion ? 'Generate and verify the immutable final PDF first.' : undefined}
            className="bg-violet-600 hover:bg-violet-700 disabled:bg-violet-800/70 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium"
          >
            {isFinalising ? <Loader2 size={20} className="animate-spin" /> : <FileCheck2 size={20} />}
            {isFinalising ? 'Finalising...' : 'Finalise Report'}
          </button>
        )}
        {report.lifecycleStatus === 'finalised' && (
          <button
            onClick={handleArchive}
            disabled={!canArchive || isArchiving}
            className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium"
          >
            {isArchiving ? <Loader2 size={20} className="animate-spin" /> : <Archive size={20} />}
            {isArchiving ? 'Creating Archive...' : 'Create Archive & Archive Report'}
          </button>
        )}
        <Link
          to={`/app/admin/reports/${report.id}/edit`}
          className="bg-white hover:bg-gray-100 text-gray-800 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium"
        >
          <Edit2 size={20} /> Back to report
        </Link>
        {(pdfJob || pdfError || lifecycleError || report.lifecycleStatus === 'archived') && (
          <div
            className={`w-full max-w-xl rounded-lg px-3 py-2 text-xs shadow-lg ${
              pdfError || lifecycleError || pdfFailed ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            {lifecycleError
              ? lifecycleError
              : pdfError
                ? pdfError
                : report.lifecycleStatus === 'archived'
                  ? `Report archived against immutable version ${report.archiveReportVersionId || report.currentVersionId}. Archive SHA-256: ${report.archiveManifestSha256 || 'stored'}.`
                  : report.lifecycleStatus === 'finalised' && archiveForCurrentVersion
                    ? `Archive manifest created for immutable version ${report.currentVersionId}. The canonical archive transition can now complete.`
                    : storedPdfForCurrentVersion
                      ? `Final PDF is stored and verified against immutable version ${report.currentVersionId}. SHA-256: ${report.finalPdfSha256}.`
                      : pdfCompleted
                        ? `PDF worker completed job ${pdfJob?.id}. Refreshing authoritative artifact provenance before finalisation.`
                        : `Final PDF job ${pdfJob?.id} is ${pdfJob?.status}. The workflow remains blocked from finalisation until the immutable PDF and render manifest are stored and verified.`}
          </div>
        )}
      </div>
      <PDFPreview data={report} />
    </div>
  );
};

export default ReportPreviewPage;
