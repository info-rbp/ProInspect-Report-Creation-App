import type { ClientSnapshot } from './clientManagement.js';

declare module './platform.js' {
  interface PropertyRecord {
    currentClientRelationshipIds?: string[];
    clientMigrationStatus?: 'not_started' | 'review_required' | 'migrated';
  }

  interface InspectionJob {
    clientAccountId?: string;
    clientEngagementId?: string;
    clientSnapshot?: ClientSnapshot;
  }
}

declare module './inspectionOperations.js' {
  interface InspectionRequest {
    clientAccountId?: string;
    clientEngagementId?: string;
    clientSnapshot?: ClientSnapshot;
  }

  interface RecurringInspectionSchedule {
    clientAccountId?: string;
  }
}

declare module './reportModel.js' {
  interface ReportMetadataRecord {
    clientAccountId?: string;
    clientEngagementId?: string;
    clientSnapshot?: ClientSnapshot;
  }
}

declare module './maintenance.js' {
  interface MaintenanceItem {
    clientAccountId?: string;
    clientSnapshot?: ClientSnapshot;
    maintenanceApprovalContactId?: string;
  }

  interface ClientApproval {
    clientContactId?: string;
  }
}

declare module './maintenanceCommercial.js' {
  interface MaintenanceQuote {
    clientContactId?: string;
    clientSnapshot?: ClientSnapshot;
  }
}

export {};
