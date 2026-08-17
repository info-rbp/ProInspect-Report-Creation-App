import { describe, expect, it } from 'vitest';
import {
  canTransitionMaintenanceItem,
  canTransitionTenantInstruction,
  canTransitionWorkRequest,
} from '../src/index.js';

describe('maintenance lifecycle policy', () => {
  it('requires maintenance to move through approval, assignment and verification before closure', () => {
    expect(canTransitionMaintenanceItem('triage_required', 'approved')).toBe(true);
    expect(canTransitionMaintenanceItem('approved', 'assigned')).toBe(true);
    expect(canTransitionMaintenanceItem('assigned', 'in_progress')).toBe(true);
    expect(canTransitionMaintenanceItem('in_progress', 'verification_required')).toBe(true);
    expect(canTransitionMaintenanceItem('verification_required', 'verified')).toBe(true);
    expect(canTransitionMaintenanceItem('verified', 'closed')).toBe(true);
    expect(canTransitionMaintenanceItem('triage_required', 'closed')).toBe(false);
    expect(canTransitionMaintenanceItem('assigned', 'closed')).toBe(false);
  });

  it('keeps contractor completion separate from agency acceptance', () => {
    expect(canTransitionWorkRequest('draft', 'issued')).toBe(true);
    expect(canTransitionWorkRequest('issued', 'acknowledged')).toBe(true);
    expect(canTransitionWorkRequest('acknowledged', 'in_progress')).toBe(true);
    expect(canTransitionWorkRequest('in_progress', 'completed')).toBe(true);
    expect(canTransitionWorkRequest('completed', 'accepted')).toBe(true);
    expect(canTransitionWorkRequest('issued', 'accepted')).toBe(false);
  });

  it('requires tenant instructions to be approved and issued before response resolution', () => {
    expect(canTransitionTenantInstruction('draft', 'approval_required')).toBe(true);
    expect(canTransitionTenantInstruction('approval_required', 'approved')).toBe(true);
    expect(canTransitionTenantInstruction('approved', 'issued')).toBe(true);
    expect(canTransitionTenantInstruction('issued', 'viewed')).toBe(true);
    expect(canTransitionTenantInstruction('viewed', 'tenant_responded')).toBe(true);
    expect(canTransitionTenantInstruction('tenant_responded', 'review_required')).toBe(true);
    expect(canTransitionTenantInstruction('review_required', 'resolved')).toBe(true);
    expect(canTransitionTenantInstruction('resolved', 'closed')).toBe(true);
    expect(canTransitionTenantInstruction('draft', 'issued')).toBe(false);
    expect(canTransitionTenantInstruction('tenant_responded', 'closed')).toBe(false);
  });
});
