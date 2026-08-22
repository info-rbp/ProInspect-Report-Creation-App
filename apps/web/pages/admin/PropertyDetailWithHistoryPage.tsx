import React from 'react';
import { useParams } from 'react-router-dom';
import HistoricalImportIntelligencePanel from '../../components/properties/HistoricalImportIntelligencePanel';
import PropertyClientRelationshipsPanel from '../../components/properties/PropertyClientRelationshipsPanel';
import PropertyFloorPlanPanel from '../../components/properties/PropertyFloorPlanPanel';
import PropertyWorkspacePage from './PropertyWorkspacePage';

const PropertyDetailWithHistoryPage: React.FC = () => {
  const { propertyId } = useParams<{ propertyId: string }>();
  return (
    <div className="space-y-6">
      <PropertyWorkspacePage />
      {propertyId && <PropertyClientRelationshipsPanel propertyId={propertyId} />}
      {propertyId && <HistoricalImportIntelligencePanel propertyId={propertyId} />}
      {propertyId && <PropertyFloorPlanPanel propertyId={propertyId} />}
    </div>
  );
};

export default PropertyDetailWithHistoryPage;
