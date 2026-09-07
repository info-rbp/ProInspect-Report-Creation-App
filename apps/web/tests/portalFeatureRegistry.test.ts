import { describe, expect, it } from 'vitest';
import { PORTAL_DEFINITIONS } from '@pcr/domain';
import { effectivePortalResources } from '../services/platform/portalFeatureBindings';
import { featureForLabel, portalFeatures } from '../services/platform/portalFeatureRegistry';

const PORTAL_IDS = ['admin', 'inspector', 'building', 'strata', 'resident', 'client', 'contractor'] as const;

describe('seven-portal feature registry', () => {
  it('provides a feature implementation for every primary navigation item', () => {
    for (const portal of PORTAL_DEFINITIONS) {
      for (const label of portal.primaryNavigation) {
        expect(featureForLabel(portal.id, label), `${portal.id}:${label}`).toBeDefined();
      }
    }
  });

  it('uses unique feature slugs within each portal', () => {
    for (const portalId of PORTAL_IDS) {
      const slugs = portalFeatures(portalId).map((feature) => feature.slug);
      expect(new Set(slugs).size, portalId).toBe(slugs.length);
      expect(slugs.length, portalId).toBeGreaterThan(0);
    }
  });

  it('keeps resident private data behind self-scoped API resources', () => {
    for (const slug of ['home', 'my-property', 'issues-requests', 'maintenance', 'inspections', 'access-keys', 'documents', 'messages', 'building-notices', 'my-household']) {
      const feature = portalFeatures('resident').find((item) => item.slug === slug);
      expect(feature, slug).toBeDefined();
      expect(effectivePortalResources('resident', feature!).some((binding) => binding.source === 'scoped'), slug).toBe(true);
    }
  });

  it('keeps contractor work, access, evidence, compliance and company data scoped', () => {
    for (const slug of ['assigned-work', 'schedule', 'site-access', 'check-in-out', 'work-orders', 'quotes', 'evidence', 'documents', 'compliance', 'my-company', 'notifications']) {
      const feature = portalFeatures('contractor').find((item) => item.slug === slug);
      expect(feature, slug).toBeDefined();
      expect(effectivePortalResources('contractor', feature!).every((binding) => binding.source === 'scoped'), slug).toBe(true);
    }
  });

  it('keeps Strata people and governance history site scoped', () => {
    for (const slug of ['residents', 'users', 'audit']) {
      const feature = portalFeatures('strata').find((item) => item.slug === slug);
      expect(feature, slug).toBeDefined();
      expect(effectivePortalResources('strata', feature!).some((binding) => binding.source === 'scoped'), slug).toBe(true);
    }
  });

  it('creates Building Management waste events rather than attempting to create configuration rows', () => {
    const feature = portalFeatures('building').find((item) => item.slug === 'waste');
    expect(feature).toBeDefined();
    expect(effectivePortalResources('building', feature!)[0]).toMatchObject({ source: 'building', resource: 'waste-events' });
  });

  it('preserves secondary operational actions outside primary navigation', () => {
    const buildingPrimary = new Set(PORTAL_DEFINITIONS.find((portal) => portal.id === 'building')?.primaryNavigation ?? []);
    const clientPrimary = new Set(PORTAL_DEFINITIONS.find((portal) => portal.id === 'client')?.primaryNavigation ?? []);
    expect(portalFeatures('building').some((feature) => feature.slug === 'activity' && !buildingPrimary.has(feature.label))).toBe(true);
    expect(portalFeatures('client').some((feature) => feature.slug === 'messages' && !clientPrimary.has(feature.label))).toBe(true);
    expect(portalFeatures('client').some((feature) => feature.slug === 'bookings' && !clientPrimary.has(feature.label))).toBe(true);
  });
});
