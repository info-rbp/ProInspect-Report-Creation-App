import React, { useEffect, useState } from 'react';
import { ClipboardList, FileCheck, FileText, Home, Hourglass, SearchCheck } from 'lucide-react';
import { listInspectionJobs } from '../services/platform/inspectionJobService';
import { listProperties } from '../services/platform/propertyService';
import { listReportIndexes } from '../services/platform/reportIndexService';

interface DashboardMetrics {
  properties: number;
  activeJobs: number;
  draftReports: number;
  reportsAwaitingReview: number;
  analysisQueued: number;
  finalisedReports: number;
}

const initialMetrics: DashboardMetrics = {
  properties: 0,
  activeJobs: 0,
  draftReports: 0,
  reportsAwaitingReview: 0,
  analysisQueued: 0,
  finalisedReports: 0,
};

const DashboardPage: React.FC = () => {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMetrics = async () => {
      setIsLoading(true);
      try {
        const [properties, jobs, reports] = await Promise.all([
          listProperties(),
          listInspectionJobs(),
          listReportIndexes(),
        ]);

        setMetrics({
          properties: properties.filter((property) => property.status !== 'archived').length,
          activeJobs: jobs.filter((job) => !['finalised', 'archived'].includes(job.status)).length,
          draftReports: reports.filter((report) => report.lifecycleStatus === 'draft').length,
          reportsAwaitingReview: reports.filter((report) => report.lifecycleStatus === 'review_required').length,
          analysisQueued: reports.filter((report) => report.lifecycleStatus === 'analysis_queued').length,
          finalisedReports: reports.filter((report) => report.lifecycleStatus === 'finalised').length,
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadMetrics();
  }, []);

  const cards = [
    { label: 'Total properties', value: metrics.properties, icon: Home },
    { label: 'Active inspection jobs', value: metrics.activeJobs, icon: ClipboardList },
    { label: 'Draft reports', value: metrics.draftReports, icon: FileText },
    { label: 'Reports awaiting review', value: metrics.reportsAwaitingReview, icon: SearchCheck },
    { label: 'Analysis queued', value: metrics.analysisQueued, icon: Hourglass },
    { label: 'Finalised reports', value: metrics.finalisedReports, icon: FileCheck },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-950">Dashboard</h1>
        <p className="text-sm text-gray-600">Operational overview for ProInspect inspections.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{card.label}</p>
                  <p className="mt-2 text-3xl font-bold text-gray-950">{isLoading ? '-' : card.value}</p>
                </div>
                <div className="grid h-11 w-11 place-items-center rounded-lg bg-gray-100 text-gray-700">
                  <Icon size={22} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DashboardPage;
