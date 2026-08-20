export * from './platform.js';
export * from './propertyIntelligence.js';
export * from './inspectionOperations.js';
export * from './security.js';
export * from './reportModel.js';
export * from './photoEvidence.js';
export * from './workflow.js';
export * from './comparisonEngine.js';
export * from './maintenance.js';
export * from './maintenanceWorkflow.js';
export * from './inspectionPolicy.js';
export * from './legacyBaseline.js';

export type InspectionType = 'entry' | 'routine' | 'exit' | 'comparison' | 'maintenance';

export interface DomainErrorShape {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
  correlationId?: string;
}
