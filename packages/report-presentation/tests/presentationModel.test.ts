import { describe, expect, it } from 'vitest';
import {
  captureBrandingSnapshot,
  defaultPresentationTemplate,
  publishBrandingProfile,
  publishPresentationTemplate,
  validatePresentationTemplate,
  type ReportBrandingProfile,
} from '../src/index.js';

describe('report presentation contracts', () => {
  it('publishes the default template as an immutable-version candidate', () => {
    const draft = defaultPresentationTemplate('2026-08-22T00:00:00.000Z');
    expect(() => validatePresentationTemplate(draft)).not.toThrow();
    const published = publishPresentationTemplate(draft, '2026-08-22T01:00:00.000Z');
    expect(published.status).toBe('published');
    expect(published.sections.some((section) => section.type === 'executive_summary')).toBe(true);
  });

  it('captures branding by value rather than by mutable reference', () => {
    const draft: ReportBrandingProfile = {
      id: 'brand-default',
      version: 1,
      status: 'draft',
      agencyName: 'Example Agency',
      primaryColour: '#123456',
      secondaryColour: '#234567',
      accentColour: '#345678',
      headingFont: 'Inter',
      bodyFont: 'Inter',
      createdAt: '2026-08-22T00:00:00.000Z',
    };
    const published = publishBrandingProfile(draft, '2026-08-22T01:00:00.000Z');
    const snapshot = captureBrandingSnapshot(published, '2026-08-22T02:00:00.000Z');
    published.agencyName = 'Changed Later';
    expect(snapshot.agencyName).toBe('Example Agency');
    expect(snapshot.profileVersion).toBe(1);
  });
});
