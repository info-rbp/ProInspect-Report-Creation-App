import { describe, expect, it } from 'vitest';
import {
  agencyBrandingProfileSchema,
  agencyOrganisationSettingsSchema,
  maintenancePolicySettingsSchema,
} from '../src/index.js';

describe('agency settings validation', () => {
  it('accepts a valid Australian organisation profile', () => {
    const result = agencyOrganisationSettingsSchema.parse({
      registeredName: 'ProInspect Pty Ltd',
      tradingName: 'ProInspect',
      abn: '12345678901',
      contactEmail: 'operations@example.com',
      website: 'https://example.com',
      timezone: 'Australia/Perth',
      locale: 'en-AU',
      currency: 'AUD',
      countryCode: 'AU',
      financialYearStartMonth: 7,
      taxLabel: 'GST',
      defaultTaxRate: 10,
      status: 'active',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid ABN, timezone and branding colour values', () => {
    expect(agencyOrganisationSettingsSchema.parse({ registeredName: 'A', abn: '123', timezone: 'Mars/Perth' }).ok).toBe(false);
    expect(agencyBrandingProfileSchema.parse({ id: 'brand-1', name: 'Brand', status: 'active', primaryColour: 'blue' }).ok).toBe(false);
  });

  it('rejects maintenance percentages outside controlled ranges', () => {
    const result = maintenancePolicySettingsSchema.parse({
      status: 'active',
      defaultTaxRate: 10,
      defaultMarkupPercent: 999,
      quoteValidityDays: 30,
      minimumContractorQuoteCount: 1,
      completionEvidenceRequired: true,
      invoiceReconciliationRequired: true,
      responseSlaHours: {},
    });
    expect(result.ok).toBe(false);
  });
});
