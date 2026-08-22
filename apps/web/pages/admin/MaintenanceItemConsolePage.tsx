import React from 'react';
import { useParams } from 'react-router-dom';
import MaintenanceClientContextPanel from '../../components/maintenance/MaintenanceClientContextPanel';
import MaintenanceItemCommercialPanel from '../../components/maintenance/MaintenanceItemCommercialPanel';
import MaintenanceDetailPage from './MaintenanceDetailPage';

const MaintenanceItemConsolePage: React.FC = () => {
  const { maintenanceId } = useParams<{ maintenanceId: string }>();
  return (
    <div>
      <MaintenanceDetailPage />
      {maintenanceId && (
        <div className="space-y-6 px-6 pb-16">
          <MaintenanceClientContextPanel maintenanceId={maintenanceId} />
          <MaintenanceItemCommercialPanel maintenanceId={maintenanceId} />
        </div>
      )}
    </div>
  );
};

export default MaintenanceItemConsolePage;
