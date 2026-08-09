import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, Edit2, FileCheck2, Loader2, Printer, TriangleAlert } from 'lucide-react';
import PDFPreview from '../../components/PDFPreview';
import type { ReportData } from '../../types';
import { loadReportFromDB } from '../../services/storageService';
import {
  getPdfJob,
  queueFinalPdf,
  type PdfJobRecord,
} from '../../services/platform/pdfJobService';

interface PreviewLocationState {
  report?: ReportData;
}

const ReportPreviewPage: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const state = location.state as PreviewLocationState | null;
  const [report, setReport] = useState<ReportData | null>(state?.report || null);
  const [isLoading, setIsLoading] = useState(!state?.report);
  const [pdfJob, setPdfJob] = useState<PdfJobRecord | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isQueueingPdf, setIsQueueingPdf] = useState(false);

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
  }, [pdfJob?.id, pdfJob?.status, report?.agencyId]);

  const handleGenerateFinalPdf = async () => {
    if (!report) return;
    setIsQueueingPdf(true);
    setPdfError(null);
    try {
      const job = await queueFinalPdf(report);
      setPdfJob(job);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Final PDF generation could not be queued.');
    } finally {
      setIsQueueingPdf(false);
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
  const finalPdfTitle = !report.currentVersionId
    ? 'An immutable report version must exist first.'
    : report.lifecycleStatus !== 'finalisation_ready'
      ? 'Resolve the issue/tenant response workflow and move the report to finalisation ready first.'
      : undefined;
  const pdfActive = pdfJob?.status === 'queued' || pdfJob?.status === 'running';
  const pdfCompleted = pdfJob?.status === 'completed';
  const pdfFailed = pdfJob?.status === 'failed' || pdfJob?.status === 'superseded';
  const generateDisabled = isQueueingPdf || !finalPdfReady || pdfActive || pdfCompleted;

  const buttonLabel = isQueueingPdf
    ? 'Queueing Final PDF...'
    : pdfJob?.status === 'queued'
      ? 'Final PDF Queued'
      : pdfJob?.status === 'running'
        ? 'Generating Final PDF...'
        : pdfCompleted
          ? 'Final PDF Generated'
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
          ) : pdfCompleted ? (
            <CheckCircle2 size={20} />
          ) : pdfFailed ? (
            <TriangleAlert size={20} />
          ) : (
            <FileCheck2 size={20} />
          )}
          {buttonLabel}
        </button>
        <Link
          to={`/app/admin/reports/${report.id}/edit`}
          className="bg-white hover:bg-gray-100 text-gray-800 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium"
        >
          <Edit2 size={20} /> Back to edit
        </Link>
        {(pdfJob || pdfError) && (
          <div
            className={`w-full max-w-xl rounded-lg px-3 py-2 text-xs shadow-lg ${
              pdfError || pdfFailed ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            {pdfError
              ? pdfError
              : pdfCompleted
                ? `Final PDF generated from immutable version ${pdfJob?.reportVersionId || report.currentVersionId}. SHA-256: ${pdfJob?.pdfSha256}. The workflow can now be finalised.`
                : `Final PDF job ${pdfJob?.id} is ${pdfJob?.status}. The workflow remains blocked from finalisation until the immutable PDF and render manifest are stored and verified.`}
          </div>
        )}
      </div>
      <PDFPreview data={report} />
    </div>
  );
};

export default ReportPreviewPage;
