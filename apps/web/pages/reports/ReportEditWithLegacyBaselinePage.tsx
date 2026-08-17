import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ReportAggregate } from '@pcr/domain';
import type { ReportData } from '../../types';
import LegacyBaselineMappingPanel from '../../components/inspection/LegacyBaselineMappingPanel';
import { apiRequest } from '../../services/apiClient';
import { aggregateToReportData } from '../../services/platform/inspectionReportService';
import ReportEditPage from './ReportEditPage';

const ReportEditWithLegacyBaselinePage: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const [report, setReport] = useState<ReportData | null>(null);

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    apiRequest<ReportAggregate>(
      undefined,
      `/api/v1/reports/${encodeURIComponent(reportId)}/aggregate`,
    )
      .then((aggregate) => {
        if (active) setReport(aggregateToReportData(aggregate));
      })
      .catch(() => {
        if (active) setReport(null);
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  return (
    <div className="space-y-5">
      {report?.baselineQuality === 'legacy_unstructured' && (
        <LegacyBaselineMappingPanel report={report} onReportChange={setReport} />
      )}
      <ReportEditPage key={`${reportId ?? 'report'}-${report?.version ?? 0}`} />
    </div>
  );
};

export default ReportEditWithLegacyBaselinePage;
