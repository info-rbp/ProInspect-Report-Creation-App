import React from 'react';
import { useParams } from 'react-router-dom';
import PropertyHistoryPanel from '../../components/properties/PropertyHistoryPanel';
import PropertyDetailPage from './PropertyDetailPage';

const PropertyDetailWithHistoryPage: React.FC = () => {
  const { propertyId } = useParams<{ propertyId: string }>();
  return (
    <div className="space-y-6">
      <PropertyDetailPage />
      {propertyId && <PropertyHistoryPanel propertyId={propertyId} />}
    </div>
  );
};

export default PropertyDetailWithHistoryPage;