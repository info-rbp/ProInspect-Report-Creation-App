import { describe, expect, it } from 'vitest';
import {
  buildInspectionJobFromRequest,
  calculateInspectionReadiness,
  deriveInspectionIntakeStatus,
  externalCancellationAction,
  inferInspectionReportType,
  mergeCalendarEventIntoRequest,
  mergeShopifyOrderIntoRequest,
  nextRecurringDueDate,
  normaliseInspectionAddress,
  parseCalendarBookingFields,
  rankInspectorAssignments,
  rankPropertyMatches,
  type InspectionRequest,
  type InspectionServiceMapping,
  type PropertyRecord,
} from '../src/index.js';

const now = '2026-08-21T00:00:00.000Z';

function request(overrides: Partial<InspectionRequest> = {}): InspectionRequest {
  return {
    id: 'request-1',
    agencyId: 'agency-1',
    source: 'shopify',
    sourceExternalId: 'gid://shopify/Order/1',
    serviceCode: 'entry-pcr',
    reportType: 'Property Condition Report',
    propertyAddressCandidate: '15/88 Beaufort Street, Highgate WA 6003',
    propertyMatchStatus: 'unmatched',
    customerName: 'Example Customer',
    customerEmail: 'customer@example.com',
    paymentStatus: 'pending',
    bookingStatus: 'awaiting_booking',
    intakeStatus: 'received',
    priority: 'normal',
    receivedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function property(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: 'property-1',
    agencyId: 'agency-1',
    address: '15/88 Beaufort Street',
    suburb: 'Highgate',
    state: 'WA',
    postcode: '6003',
    propertyUse: 'residential',
    physicalPropertyType: 'apartment',
    ownershipStructure: 'strata',
    currentLayoutVersionId: 'layout-2',
    roomsConfig: [{ id: 'entry', name: 'Entry', roomType: 'hallway' }],
    alerts: [{ id: 'alert-1', type: 'access', severity: 'warning', message: 'Concierge access required.', active: true, createdAt: now }],
    accessDetails: { accessNotes: 'Collect the swipe fob from reception.' },
    clientIds: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const mapping: InspectionServiceMapping = {
  id: 'shopify-entry',
  agencyId: 'agency-1',
  provider: 'shopify',
  active: true,
  serviceCode: 'entry-pcr',
  label: 'Property Condition Report',
  productId: 'gid://shopify/Product/1',
  reportType: 'Property Condition Report',
  propertyUse: 'residential',
  defaultDurationMinutes: 60,
  paymentRequired: true,
  manualApprovalRequired: false,
  defaultPriority: 'normal',
  createdAt: now,
  updatedAt: now,
};

describe('inspection intake matching', () => {
  it('normalises Australian unit and street address variants', () => {
    expect(normaliseInspectionAddress('Unit 15, 88 Beaufort St, Highgate WA 6003')).toBe(
      normaliseInspectionAddress('15/88 Beaufort Street, Highgate, WA 6003'),
    );
  });

  it('ranks the matching ProInspect property above unrelated properties', () => {
    const matches = rankPropertyMatches('Unit 15, 88 Beaufort St, Highgate WA 6003', [
      property(),
      property({ id: 'property-2', address: '104 Ocean Drive', suburb: 'Scarborough', postcode: '6019' }),
    ]);
    expect(matches[0]?.propertyId).toBe('property-1');
    expect(matches[0]?.score).toBeGreaterThan(0.9);
  });

  it('keeps payment, booking and property matching as independent gates', () => {
    expect(deriveInspectionIntakeStatus(request())).toBe('awaiting_payment');
    expect(deriveInspectionIntakeStatus(request({ paymentStatus: 'paid' }))).toBe('awaiting_booking');
    expect(
      deriveInspectionIntakeStatus(
        request({ paymentStatus: 'paid', bookingStatus: 'booked' }),
      ),
    ).toBe('awaiting_property');
    expect(
      deriveInspectionIntakeStatus(
        request({
          paymentStatus: 'paid',
          bookingStatus: 'booked',
          propertyMatchStatus: 'matched',
        }),
      ),
    ).toBe('ready_for_job');
  });
});

describe('Shopify and Google booking composition', () => {
  it('maps a paid Shopify order to the configured inspection service', () => {
    const merged = mergeShopifyOrderIntoRequest(
      request(),
      {
        shopDomain: 'proinspect.myshopify.com',
        orderGid: 'gid://shopify/Order/1',
        orderNumber: '#1001',
        customerName: 'Example Customer',
        customerEmail: 'customer@example.com',
        financialStatus: 'paid',
        lines: [{
          lineItemId: 'line-1',
          productId: 'gid://shopify/Product/1',
          title: 'Property Condition Report',
          quantity: 1,
        }],
        createdAt: now,
        updatedAt: now,
      },
      mapping,
    );
    expect(merged.paymentStatus).toBe('paid');
    expect(merged.reportType).toBe('Property Condition Report');
    expect(merged.durationMinutes).toBe(60);
  });

  it('extracts booking questions from a Google appointment description', () => {
    const fields = parseCalendarBookingFields([
      'Booked by: Example Customer',
      'customer@example.com',
      'Full Property Address: 15/88 Beaufort Street, Highgate WA 6003',
      'Access Information: Concierge has the swipe fob',
      'Shopify Order: #1001',
    ].join('\n'));
    expect(fields.customerEmail).toBe('customer@example.com');
    expect(fields.propertyAddress).toContain('Beaufort');
    expect(fields.accessInstructions).toContain('Concierge');
    expect(fields.orderNumber).toBe('#1001');
  });

  it('adds a confirmed Calendar appointment without changing Shopify payment authority', () => {
    const merged = mergeCalendarEventIntoRequest(
      request({ paymentStatus: 'paid' }),
      {
        calendarId: 'calendar-1',
        eventId: 'event-1',
        summary: 'ProInspect: Property Condition Report',
        description: 'Property Address: 15/88 Beaufort Street, Highgate WA 6003',
        startAt: '2026-08-25T01:00:00.000Z',
        endAt: '2026-08-25T02:00:00.000Z',
        timezone: 'Australia/Perth',
        eventStatus: 'confirmed',
        lastSyncedAt: now,
      },
      { ...mapping, provider: 'google_calendar', paymentRequired: false },
    );
    expect(merged.paymentStatus).toBe('paid');
    expect(merged.bookingStatus).toBe('booked');
    expect(merged.requestedStartAt).toBe('2026-08-25T01:00:00.000Z');
  });
});

describe('job conversion and readiness', () => {
  it('converts only a ready intake and snapshots property layout/access context', () => {
    const input = request({
      propertyId: 'property-1',
      tenancyId: 'tenancy-1',
      propertyMatchStatus: 'matched',
      paymentStatus: 'paid',
      bookingStatus: 'booked',
      intakeStatus: 'ready_for_job',
      requestedStartAt: '2026-08-25T01:00:00.000Z',
      requestedEndAt: '2026-08-25T02:00:00.000Z',
      timezone: 'Australia/Perth',
      accessInstructions: 'Collect swipe fob from reception.',
    });
    const job = buildInspectionJobFromRequest(input, property(), now);
    expect(job.propertySnapshot?.propertyLayoutVersionId).toBe('layout-2');
    expect(job.propertySnapshot?.alertMessages).toContain('Concierge access required.');
    expect(job.accessStatus).toBe('instructions_available');
  });

  it('blocks field work until operational prerequisites are complete', () => {
    const result = calculateInspectionReadiness({
      request: request({
        propertyMatchStatus: 'matched',
        paymentStatus: 'paid',
        bookingStatus: 'booked',
      }),
      job: {
        propertyId: 'property-1',
        tenancyId: 'tenancy-1',
        reportType: 'Property Condition Report',
        scheduledAt: '2026-08-25T01:00:00.000Z',
        assignedInspectorId: undefined,
        assignedReviewerId: 'reviewer-1',
        templateId: 'template-entry',
        accessStatus: 'confirmed',
        propertySnapshot: undefined,
      },
      property: property(),
      paymentRequired: true,
      entryBaselineAvailable: true,
    });
    expect(result.readyForJob).toBe(true);
    expect(result.readyForFieldWork).toBe(false);
    expect(result.blockers.some((blocker) => blocker.code === 'INSPECTOR_REQUIRED')).toBe(true);
  });
});

describe('scheduling and assignment policy', () => {
  it('preserves progressed jobs when an external order is cancelled', () => {
    expect(externalCancellationAction(undefined)).toBe('cancel_intake');
    expect(externalCancellationAction('booked')).toBe('cancel_job_and_release_booking');
    expect(externalCancellationAction('assigned')).toBe('require_operator_review');
    expect(externalCancellationAction('inspection_started')).toBe('preserve_job_and_raise_exception');
  });

  it('calculates recurring due dates without pre-creating years of speculative jobs', () => {
    expect(nextRecurringDueDate({ cadence: 'quarterly' }, '2026-08-21T00:00:00.000Z')).toBe('2026-11-21T00:00:00.000Z');
  });

  it('ranks qualified inspectors with remaining capacity above overloaded staff', () => {
    const candidates = rankInspectorAssignments(
      [
        {
          id: 'profile-1',
          agencyId: 'agency-1',
          userId: 'inspector-1',
          displayName: 'Available Inspector',
          role: 'inspector',
          active: true,
          inspectionTypes: ['Routine Inspection'],
          propertyUses: ['residential'],
          serviceAreas: ['Highgate'],
          commercialQualified: false,
          strataQualified: true,
          maxJobsPerDay: 3,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'profile-2',
          agencyId: 'agency-1',
          userId: 'inspector-2',
          displayName: 'Overloaded Inspector',
          role: 'inspector',
          active: true,
          inspectionTypes: ['Routine Inspection'],
          propertyUses: ['residential'],
          serviceAreas: ['Highgate'],
          commercialQualified: false,
          strataQualified: true,
          maxJobsPerDay: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      {
        reportType: 'Routine Inspection',
        propertyUse: 'residential',
        suburbOrPostcode: 'Highgate 6003',
        scheduledAt: '2026-08-25T01:00:00.000Z',
        jobs: [
          { assignedInspectorId: 'inspector-2', scheduledAt: '2026-08-25T03:00:00.000Z', status: 'booked' },
        ],
      },
    );
    expect(candidates[0]?.userId).toBe('inspector-1');
    expect(candidates.at(-1)?.userId).toBe('inspector-2');
  });

  it('infers canonical report types from order and booking labels', () => {
    expect(inferInspectionReportType('Commercial Exit Inspection')).toBe('Exit Inspection');
    expect(inferInspectionReportType('Routine Inspection Booking')).toBe('Routine Inspection');
    expect(inferInspectionReportType('Maintenance Follow-Up')).toBe('Maintenance and Follow-Up Report');
  });
});
