import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return 'agency-1';
  return (
    window.localStorage.getItem('pcr_agency_id') ||
    window.localStorage.getItem('agencyId') ||
    'agency-1'
  );
}

export interface BookingInvitationAutomationResult {
  queued: string[];
  skipped: Array<{ requestId: string; reason: string }>;
}

export async function runBookingInvitationAutomation(): Promise<BookingInvitationAutomationResult> {
  return apiRequest<BookingInvitationAutomationResult>(
    agencyId(),
    '/api/v1/inspection-operations/run-booking-invitations',
    { method: 'POST', body: {} },
  );
}
