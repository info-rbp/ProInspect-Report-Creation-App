import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  FileCheck,
  FileText,
  Home,
  Hourglass,
  Link2,
  SearchCheck,
  ShoppingBag,
  UserRoundX,
} from 'lucide-react';
import { getInspectionOperationsOverview } from '../services/platform/inspectionOperationsService';
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
  newIntake: number;
  awaitingBooking: number;
  propertyMatchRequired: number;
  unassignedJobs: number;
  syncExceptions: number;
}

const initialMetrics: DashboardMetrics = {
  properties: 0,
  activeJobs: 0,
  draftReports: 0,
  reportsAwaitingReview: 0,
  analysisQueued: 0,
  finalisedReports: 0,
  newIntake: 0,
  awaitingBooking: 0,
  propertyMatchRequired: 0,
  unassignedJobs: 0,
  syncExceptions: 0,
};

const DashboardPage: React.FC = () => {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMetrics = async () => {
      setIsLoading(true);
      try {
        const [properties, jobs, reports, operations] = await Promise.all([
          listProperties(),
          listInspectionJobs(),
          listReportIndexes(),
          getInspectionOperationsOverview(),
        ]);

        setMetrics({
          properties: properties.filter((property) => property.status !== 'archived').length,
          activeJobs: jobs.filter((job) => !['finalised', 'archived', 'cancelled'].includes(job.status)).length,
          draftReports: reports.filter((report) => report.lifecycleStatus === 'draft').length,
          reportsAwaitingReview: reports.filter((report) => report.lifecycleStatus === 'review_required').length,
          analysisQueued: reports.filter((report) => report.lifecycleStatus === 'analysis_queued').length,
          finalisedReports: reports.filter((report) => report.lifecycleStatus === 'finalised').length,
          newIntake: operations.intake.new,
          awaitingBooking: operations.intake.awaitingBooking,
          propertyMatchRequired: operations.intake.propertyMatchRequired,
          unassignedJobs: operations.jobs.unassigned,
          syncExceptions: operations.integrations.openExceptions,
        });
      } finally {
        setIsLoading(false);
      }
    };

    void loadMetrics();
  }, []);

  const cards = [
    { label: 'Total properties', value: metrics.properties, icon: Home },
    { label: 'Active inspection jobs', value: metrics.activeJobs, icon: ClipboardList },
    { label: 'Draft reports', value: metrics.draftReports, icon: FileText },
    { label: 'Reports awaiting review', value: metrics.reportsAwaitingReview, icon: SearchCheck },
    { label: 'Analysis queued', value: metrics.analysisQueued, icon: Hourglass },
    { label: 'Finalised reports', value: metrics.finalisedReports, icon: FileCheck },
  ];

  const operations = [
    { label: 'New intake', value: metrics.newIntake, icon: ShoppingBag, tab: 'intake' },
    { label: 'Awaiting booking', value: metrics.awaitingBooking, icon: CalendarClock, tab: 'intake' },
    { label: 'Property match required', value: metrics.propertyMatchRequired, icon: Link2, tab: 'intake' },
    { label: 'Unassigned jobs', value: metrics.unassignedJobs, icon: UserRoundX, tab: 'assignment' },
    { label: 'Sync exceptions', value: metrics.syncExceptions, icon: AlertTriangle, tab: 'sync' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-950">Dashboard</h1>
        <p className="text-sm text-gray-600">Operational overview for ProInspect inspections.</p>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Inspection operations</h2>
          <Link to="/app/admin/jobs" className="text-xs font-semibold text-blue-600 hover:text-blue-700">Open operations</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {operations.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.label} to={`/app/admin/jobs?tab=${card.tab}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500">{card.label}</p>
                    <p className="mt-1 text-2xl font-bold text-gray-950">{isLoading ? '-' : card.value}</p>
                  </div>
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700"><Icon size={18} /></div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Portfolio and reporting</h2>
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
      </section>
    </div>
  );
};

export default DashboardPage;
