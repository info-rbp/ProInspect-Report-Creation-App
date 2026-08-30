import { describe, expect, it } from 'vitest';
import {
  canCloseDefect,
  canCloseMoveBooking,
  canSignOutContractorAttendance,
  canTransitionAccessDeviceRequest,
  canTransitionDefect,
  canTransitionMoveBooking,
  canTransitionOperationalWorkOrder,
  contractorComplianceStatus,
  isImmediateOperationalEscalation,
  portalDefinitionsForRole,
  portalRoleHasCapability,
  assertFinalOperationalReportImmutable,
} from '../src/buildingManagement.js';

describe('building management workflow policy', () => {
  it('enforces defect lifecycle gates and closure evidence', () => {
    expect(canTransitionDefect('new', 'bm_assessment')).toBe(true);
    expect(canTransitionDefect('new', 'closed')).toBe(false);
    expect(canCloseDefect({ status: 'completed', hasCompletionEvidence: false, verifiedByUserId: 'bm-1' }).allowed).toBe(false);
    expect(canCloseDefect({ status: 'completed', hasCompletionEvidence: true, verifiedByUserId: 'bm-1' }).allowed).toBe(true);
  });

  it('enforces work order and move booking transitions', () => {
    expect(canTransitionOperationalWorkOrder('created', 'scheduled')).toBe(true);
    expect(canTransitionOperationalWorkOrder('created', 'verified')).toBe(false);
    expect(canTransitionMoveBooking('approved', 'pre_move_setup')).toBe(true);
    expect(canCloseMoveBooking({ status: 'post_move_inspection', keysReturned: true, hasPostMoveInspection: true }).allowed).toBe(true);
    expect(canCloseMoveBooking({ status: 'post_move_inspection', keysReturned: false, hasPostMoveInspection: true }).allowed).toBe(false);
  });

  it('requires returned keys or an audited override at contractor sign-out', () => {
    expect(canSignOutContractorAttendance({ keyIssued: false, keyReturned: false })).toEqual({ allowed: true, requiresOverride: false });
    expect(canSignOutContractorAttendance({ keyIssued: true, keyReturned: false }).allowed).toBe(false);
    expect(canSignOutContractorAttendance({ keyIssued: true, keyReturned: false, overrideReason: 'Key retained for approved return visit.' })).toEqual({ allowed: true, requiresOverride: true });
  });

  it('preserves access request order and immediate escalation rules', () => {
    expect(canTransitionAccessDeviceRequest('submitted', 'approved')).toBe(true);
    expect(canTransitionAccessDeviceRequest('submitted', 'issued')).toBe(false);
    expect(isImmediateOperationalEscalation('high')).toBe(true);
    expect(isImmediateOperationalEscalation('low')).toBe(false);
  });
});

describe('portal access and contractor compliance', () => {
  it('resolves role-specific portal experiences', () => {
    expect(portalDefinitionsForRole('building_manager').map((portal) => portal.id)).toEqual(['building']);
    expect(portalDefinitionsForRole('resident_tenant').map((portal) => portal.id)).toEqual(['resident']);
    expect(portalDefinitionsForRole('proinspect_admin')).toHaveLength(7);
    expect(portalRoleHasCapability('strata_manager', 'operational_approval.decide')).toBe(true);
    expect(portalRoleHasCapability('council_member', 'operational_approval.decide')).toBe(false);
  });

  it('calculates active compliance states without widening access', () => {
    const now = new Date('2026-08-30T00:00:00.000Z');
    expect(contractorComplianceStatus({ now })).toBe('not_configured');
    expect(contractorComplianceStatus({ now, insuranceExpiresAt: '2026-08-20T00:00:00.000Z' })).toBe('expired');
    expect(contractorComplianceStatus({ now, insuranceExpiresAt: '2026-09-10T00:00:00.000Z' })).toBe('expiring');
    expect(contractorComplianceStatus({ now, insuranceExpiresAt: '2027-08-30T00:00:00.000Z' })).toBe('valid');
    expect(contractorComplianceStatus({ now, suspended: true, insuranceExpiresAt: '2027-08-30T00:00:00.000Z' })).toBe('suspended');
  });
});

describe('operational report immutability', () => {
  it('allows supersession but rejects update and delete of final reports', () => {
    expect(() => assertFinalOperationalReportImmutable({ immutable: true, existingFinalisedAt: '2026-08-30T00:00:00.000Z', requestedMutation: 'supersede' })).not.toThrow();
    expect(() => assertFinalOperationalReportImmutable({ immutable: true, existingFinalisedAt: '2026-08-30T00:00:00.000Z', requestedMutation: 'update' })).toThrowError(/immutable/u);
  });
});
