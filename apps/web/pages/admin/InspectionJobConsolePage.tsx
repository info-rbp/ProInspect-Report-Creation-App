import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import InspectionJobOperationsPanel from '../../components/jobs/InspectionJobOperationsPanel';
import { InspectionJobDetailPage } from './InspectionJobDetailPage';

export const InspectionJobConsolePage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const [tab, setTab] = useState<'workflow' | 'operations'>('workflow');

  return (
    <div className="space-y-5">
      <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1" aria-label="Inspection job console sections">
        <button
          type="button"
          onClick={() => setTab('workflow')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'workflow' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          Workflow & report
        </button>
        <button
          type="button"
          onClick={() => setTab('operations')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'operations' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          Booking, access & communications
        </button>
      </nav>
      {tab === 'workflow' ? <InspectionJobDetailPage /> : jobId ? <InspectionJobOperationsPanel jobId={jobId} /> : null}
    </div>
  );
};

export default InspectionJobConsolePage;
