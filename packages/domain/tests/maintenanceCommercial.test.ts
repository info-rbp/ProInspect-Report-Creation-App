import { describe, expect, it } from 'vitest';
import {
  calculateEstimateLine,
  canTransitionMaintenanceQuote,
  maintenanceSlaDueAt,
  maintenanceSlaStatus,
  matchPriceBookEntries,
  quoteLineFromEstimate,
  quoteTotals,
  resolveQuoteApproval,
  type MaintenanceItem,
  type PriceBookEntry,
  type QuoteApprovalPolicy,
} from '../src/index.js';

const entry: PriceBookEntry = {
  id: 'entry-plumbing-tap',
  code: 'PLUMB-TAP-001',
  active: true,
  trade: 'Plumber',
  category: 'Plumbing',
  componentPattern: 'tap basin tap',
  issueType: 'leak',
  recommendedAction: 'replace cartridge',
  keywords: ['leaking', 'dripping'],
  propertyUses: ['residential'],
  physicalPropertyTypes: [],
  regions: ['Perth'],
  postcodes: ['6000'],
  unit: 'each',
  defaultQuantity: 1,
  minimumQuantity: 1,
  labourHours: 1,
  labourRate: 110,
  materialCost: 45,
  calloutCost: 85,
  travelCost: 0,
  disposalCost: 0,
  subcontractorCost: 0,
  markupPercent: 20,
  fixedMargin: 0,
  administrationFee: 15,
  minimumSellPrice: 300,
  gstRate: 0.1,
  taxable: true,
  clientDescription: 'Replace leaking basin tap cartridge and test for leaks.',
  inclusions: ['Standard cartridge', 'Functional leak test'],
  exclusions: ['Concealed pipework repairs'],
  warrantyDays: 90,
  siteAssessmentRequired: false,
  automationConfidenceThreshold: 0.7,
  xeroItemCode: 'PLUMB-TAP-001',
  xeroSalesAccountCode: '200',
  xeroPurchaseAccountCode: '300',
  xeroTaxType: 'OUTPUT',
  effectiveFrom: '2026-01-01',
  sourceRowNumber: 2,
};

const item = {
  id: 'maintenance-1',
  agencyId: 'agency-1',
  propertyId: 'property-1',
  title: 'Basin tap leaking',
  description: 'The basin tap is visibly dripping at the cartridge.',
  category: 'Plumbing',
  priority: 'routine',
  status: 'triage_required',
  sourceEvidenceIds: ['photo-1'],
  approvalRequired: true,
  approvalStatus: 'pending',
  verificationStatus: 'unverified',
  issueType: 'leak',
  recommendedAction: 'Replace cartridge',
  pricingStatus: 'not_started',
  responsibility: 'owner',
  createdBy: 'user-1',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  version: 1,
} satisfies MaintenanceItem;

describe('maintenance commercial pricing', () => {
  it('matches structured maintenance facts to the published price entry', () => {
    const matches = matchPriceBookEntries(
      item,
      [entry],
      {
        propertyUse: 'residential',
        postcode: '6000',
        region: 'Perth',
      },
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.entry.code).toBe('PLUMB-TAP-001');
    expect(matches[0]?.score).toBeGreaterThan(0.7);
    expect(matches[0]?.reasons.join(' ')).toMatch(/category|component|issue/i);
  });

  it('calculates direct cost, markup, GST and minimum selling price deterministically', () => {
    const line = calculateEstimateLine(
      entry,
      { quantity: 1 },
      { score: 0.95, reasons: ['Canonical price-book match.'] },
    );
    expect(line.directCost).toBe(240);
    expect(line.markupAmount).toBe(48);
    expect(line.administrationFee).toBe(15);
    expect(line.sellPriceExcludingTax).toBe(303);
    expect(line.taxAmount).toBe(30.3);
    expect(line.totalIncludingTax).toBe(333.3);

    const quoteLine = quoteLineFromEstimate(line);
    const totals = quoteTotals([quoteLine]);
    expect(totals).toEqual({ subtotal: 303, totalTax: 30.3, total: 333.3 });
  });
});

describe('maintenance quote approval controls', () => {
  const policy: QuoteApprovalPolicy = {
    id: 'policy-1',
    agencyId: 'agency-1',
    name: 'Standard owner approvals',
    active: true,
    propertyUses: ['residential'],
    propertyManagerDelegatedLimit: 500,
    landlordApprovalThreshold: 500,
    secondApprovalThreshold: 5000,
    emergencyAuthorisationLimit: 1000,
    mandatoryReplacementApproval: true,
    mandatoryCapitalApproval: true,
    mandatoryCosmeticApproval: true,
    autoApprovePreauthorisedServices: false,
    approvalLinkExpiryHours: 168,
    reminderHours: [24, 72, 120],
    createdBy: 'admin-1',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    version: 1,
  };

  it('requires owner approval above delegated authority', () => {
    const result = resolveQuoteApproval(policy, {
      total: 750,
      replacement: false,
      capital: false,
      cosmetic: false,
      emergency: false,
      preauthorised: false,
    });
    expect(result.required).toBe(true);
    expect(result.recipientType).toBe('landlord');
    expect(result.reasons.join(' ')).toMatch(/threshold|delegated/i);
  });

  it('requires approval for replacements even below the ordinary threshold', () => {
    const result = resolveQuoteApproval(policy, {
      total: 250,
      replacement: true,
      capital: false,
      cosmetic: false,
      emergency: false,
      preauthorised: false,
    });
    expect(result.required).toBe(true);
    expect(result.reasons.join(' ')).toMatch(/replacement/i);
  });

  it('prevents invalid lifecycle shortcuts', () => {
    expect(canTransitionMaintenanceQuote('draft', 'pricing_review_required')).toBe(true);
    expect(canTransitionMaintenanceQuote('internally_approved', 'ready_to_send')).toBe(true);
    expect(canTransitionMaintenanceQuote('ready_to_send', 'sent')).toBe(true);
    expect(canTransitionMaintenanceQuote('sent', 'accepted')).toBe(true);
    expect(canTransitionMaintenanceQuote('accepted', 'converted_to_work_order')).toBe(true);
    expect(canTransitionMaintenanceQuote('draft', 'accepted')).toBe(false);
    expect(canTransitionMaintenanceQuote('sent', 'invoiced')).toBe(false);
  });
});

describe('maintenance SLA policy', () => {
  it('assigns shorter response windows to urgent work', () => {
    const from = new Date('2026-08-20T00:00:00.000Z');
    const urgent = Date.parse(maintenanceSlaDueAt('urgent', from));
    const routine = Date.parse(maintenanceSlaDueAt('routine', from));
    expect(urgent).toBeLessThan(routine);
  });

  it('classifies overdue and at-risk deadlines', () => {
    const now = Date.parse('2026-08-20T11:00:00.000Z');
    expect(
      maintenanceSlaStatus('2026-08-20T10:00:00.000Z', 'triage_required', now),
    ).toBe('overdue');
    expect(
      maintenanceSlaStatus('2026-08-20T12:00:00.000Z', 'triage_required', now),
    ).toBe('at_risk');
    expect(
      maintenanceSlaStatus('2026-08-25T12:00:00.000Z', 'triage_required', now),
    ).toBe('on_track');
  });
});
