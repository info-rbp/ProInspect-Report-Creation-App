import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Edit2, Loader2, Printer } from 'lucide-react';
import PDFPreview from '../../components/PDFPreview';
import type { ReportData } from '../../types';
import { loadReportFromDB } from '../../services/storageService';

interface PreviewLocationState {
  report?: ReportData;
}

const ReportPreviewPage: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const state = location.state as PreviewLocationState | null;
  const [report, setReport] = useState<ReportData | null>(state?.report || null);
  const [isLoading, setIsLoading] = useState(!state?.report);

  useEffect(() => {
    const loadReport = async () => {
      if (state?.report || !reportId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        setReport(await loadReportFromDB(reportId) || null);
      } finally {
        setIsLoading(false);
      }
    };

    loadReport();
  }, [reportId, state?.report]);

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-600 text-white">
        <div className="flex items-center gap-2"><Loader2 className="animate-spin" size={20} /> Loading preview...</div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-950">Report not found</h1>
          <Link to="/app/admin/reports" className="mt-4 inline-flex rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">Back to reports</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-600 py-8 print:bg-white print:p-0 print:m-0 print:h-auto print:w-full">
      <div className="fixed top-4 right-4 flex gap-4 no-print z-50">
        <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium">
          <Printer size={20} /> Print / Save PDF
        </button>
        <Link to={`/app/admin/reports/${report.id}/edit`} className="bg-white hover:bg-gray-100 text-gray-800 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 font-medium">
          <Edit2 size={20} /> Back to edit
        </Link>
      </div>
      <PDFPreview data={report} />
    </div>
  );
};

export default ReportPreviewPage;
