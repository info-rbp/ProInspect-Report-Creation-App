import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, Edit2, FileCheck2, Loader2, Printer } from 'lucide-react';
import PDFPreview from '../../components/PDFPreview';
import type { ReportData } from '../../types';
import { loadReportFromDB } from '../../services/storageService';
import { queueFinalPdf, type PdfJobRecord } from '../../services/platform/pdfJobService';

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
          disabled={isQueueingPdf || !finalPdfReady || Boolean(pdfJob)}
          title={finalPdfTitle}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800/70 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium"
        >
          {isQueueingPdf ? (
            <Loader2 size={20} className="animate-spin" />
          ) : pdfJob ? (
            <CheckCircle2 size={20} />
          ) : (
            <FileCheck2 size={20} />
          )}
          {isQueueingPdf ? 'Queueing Final PDF...' : pdfJob ? 'Final PDF Queued' : 'Generate Final PDF'}
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
              pdfError ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            {pdfError
              ? pdfError
              : `Final PDF job ${pdfJob?.id} has been queued from immutable version ${report.currentVersionId}. The linked inspection job will become eligible for finalisation after the worker records the stored PDF artifact.`}
          </div>
        )}
      </div>
      <PDFPreview data={report} />
    </div>
  );
};

export default ReportPreviewPage;
