import type {
  GoogleCalendarReference,
  InspectionAccessStatus,
  InspectionBookingStatus,
  InspectionIntakeStatus,
  InspectionJobPropertySnapshot,
  InspectionPaymentStatus,
  InspectionPriority,
  InspectionPropertyMatchStatus,
  InspectionReadinessResult,
  InspectionRequest,
  InspectionRequestSource,
  ShopifyOrderReference,
} from './inspectionOperations.js';

/**
 * Inspection operations extend the canonical job without removing any legacy
 * fields. This keeps existing report/workflow code compatible while the queue,
 * intake and integration modules adopt the richer operational record.
 */
declare module './platform.js' {
  interface InspectionJob {
    inspectionRequestId?: string;
    source?: InspectionRequestSource;
    paymentStatus?: InspectionPaymentStatus;
    bookingStatus?: InspectionBookingStatus;
    propertyMatchStatus?: InspectionPropertyMatchStatus;
    priority?: InspectionPriority;
    durationMinutes?: number;
    scheduledEndAt?: string;
    timezone?: string;
    accessStatus?: InspectionAccessStatus;
    propertySnapshot?: InspectionJobPropertySnapshot;
    shopifyOrder?: ShopifyOrderReference;
    googleCalendar?: GoogleCalendarReference;
    readiness?: InspectionReadinessResult;
    recurringScheduleId?: string;
    templateId?: string;
    templateVersion?: number;
    propertyLayoutVersionId?: string;
    dueAt?: string;
    slaStatus?: 'on_track' | 'at_risk' | 'overdue' | 'not_applicable';
    lastReminderAt?: string;
    lastSyncedAt?: string;
    lastCalendarSyncStatus?: 'pending' | 'synchronised' | 'conflict' | 'failed' | 'not_required';
  }
}

declare module './inspectionOperations.js' {
  interface InspectionServiceMapping {
    /** Optimistic-lock version returned by the platform repository. */
    version?: number;
  }

  /**
   * Consumers may pass the complete request snapshot while deriving intake
   * state. propertyId itself does not influence the result; propertyMatchStatus
   * remains the authoritative matching signal.
   */
  function deriveInspectionIntakeStatus(
    request: Pick<
      InspectionRequest,
      | 'paymentStatus'
      | 'bookingStatus'
      | 'propertyMatchStatus'
      | 'inspectionJobId'
      | 'duplicateOfRequestId'
      | 'cancelledAt'
      | 'failureCode'
      | 'propertyId'
    >,
    paymentRequired?: boolean,
  ): InspectionIntakeStatus;
}

export {};
