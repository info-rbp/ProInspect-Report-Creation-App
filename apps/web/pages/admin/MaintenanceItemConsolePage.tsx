import React from 'react';
import { useParams } from 'react-router-dom';
import MaintenanceItemCommercialPanel from '../../components/maintenance/MaintenanceItemCommercialPanel';
import MaintenanceDetailPage from './MaintenanceDetailPage';

const MaintenanceItemConsolePage: React.FC = () => {
  const { maintenanceId } = useParams<{ maintenanceId: string }>();
  return (
    <div>
      <MaintenanceDetailPage />
      {maintenanceId && (
        <div className="px-6 pb-16">
          <MaintenanceItemCommercialPanel maintenanceId={maintenanceId} />
        </div>
      )}
    </div>
  );
};

export default MaintenanceItemConsolePage;
