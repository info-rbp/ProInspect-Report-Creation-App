import React from 'react';
import { useParams } from 'react-router-dom';
import InspectionJobOperationsPanel from '../../components/jobs/InspectionJobOperationsPanel';
import { InspectionJobDetailPage } from './InspectionJobDetailPage';

export const InspectionJobConsolePage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  return (
    <div className="space-y-6">
      <InspectionJobDetailPage />
      {jobId ? <InspectionJobOperationsPanel jobId={jobId} /> : null}
    </div>
  );
};

export default InspectionJobConsolePage;
