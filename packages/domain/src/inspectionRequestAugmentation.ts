import type { InspectionRequest } from './inspectionOperations.js';

declare module './inspectionOperations.js' {
  interface InspectionRequest {
    /** Booking page selected by the service mapping for a paid request awaiting an appointment. */
    bookingPageUrl?: string;
    /** Time the booking link notification was first queued. */
    bookingLinkSentAt?: string;
    /** Communication record created for the booking invitation. */
    bookingLinkCommunicationId?: string;
  }
}

export type InspectionRequestWithBookingLink = InspectionRequest;
