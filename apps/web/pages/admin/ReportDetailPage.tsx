import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ReportIndex } from '../../types/platform';
import { getReportIndex } from '../../services/platform/reportIndexService';

const ReportDetailPage: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const [reportIndex, setReportIndex] = useState<ReportIndex | null>(null);

  useEffect(() => {
    if (!reportId) {
      return;
    }

    getReportIndex(reportId).then((report) => setReportIndex(report || null));
  }, [reportId]);

  if (!reportIndex) {
    return <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">Report index not found.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-950">{reportIndex.propertyAddress || 'Untitled report'}</h1>
        <p className="text-sm text-gray-600">{reportIndex.reportType} - {reportIndex.lifecycleStatus.replaceAll('_', ' ')}</p>
      </div>
      <div className="flex gap-2">
        <Link to={`/app/admin/reports/${reportIndex.reportId}/edit`} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">Edit report</Link>
        <Link to={`/app/admin/reports/${reportIndex.reportId}/preview`} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">Preview report</Link>
      </div>
    </div>
  );
};

export default ReportDetailPage;
