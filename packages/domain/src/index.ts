import './inspectionJobAugmentation.js';
import './inspectionRequestAugmentation.js';
import './maintenanceCommercial.js';
import './maintenanceCanonicalAugmentation.js';
import './reportOperations.js';
import './reportMetadataAugmentation.js';
import './clientAugmentation.js';
import './propertyCatalogueAugmentation.js';

export * from './platform.js';
export * from './propertyCatalogueAugmentation.js';
export * from './propertyIntelligence.js';
export * from './inspectionOperations.js';
export * from './inspectionPlanning.js';
export * from './clientManagement.js';
export * from './clientCompatibility.js';
export * from './tenant.js';
export * from './jurisdictionPolicy.js';
export * from './documentPackets.js';
export * from './electronicSignatures.js';
export * from './communications.js';
export * from './compliance.js';
export * from './integrations.js';
export * from './keyManagement.js';
export * from './remoteInspection.js';
export * from './security.js';
export * from './people.js';
export * from './agencySettings.js';
export * from './dashboard.js';
export * from './reportModel.js';
export * from './reportOperations.js';
export * from './photoEvidence.js';
export * from './workflow.js';
export * from './comparisonEngine.js';
export * from './maintenance.js';
export * from './maintenanceCommercial.js';
export * from './maintenanceCanonicalAugmentation.js';
export * from './canonicalMaintenancePricing.js';
export * from './maintenanceWorkflow.js';
export * from './inspectionPolicy.js';
export * from './legacyBaseline.js';
export * from './canonicalIdentity.js';

export type InspectionType = 'entry' | 'routine' | 'exit' | 'comparison' | 'maintenance';

export interface DomainErrorShape {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
  correlationId?: string;
}
