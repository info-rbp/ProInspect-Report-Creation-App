import { describe, expect, it } from 'vitest';
import { resolveMfaSessionDecision, roleRequiresMfa } from '../services/mfaPolicy';

describe('privileged MFA policy', () => {
  it('requires enrolment for a privileged user with no enrolled factor', () => {
    expect(resolveMfaSessionDecision('super_admin', {
      verified: false,
      enrolledFactors: 0,
      emailVerified: true,
    })).toBe('enrollment');
  });

  it('requires a fresh MFA sign-in for a restored privileged password-only session', () => {
    expect(resolveMfaSessionDecision('reviewer', {
      verified: false,
      enrolledFactors: 1,
      emailVerified: true,
    })).toBe('reauthentication-required');
  });

  it('does not force a non-privileged user through MFA', () => {
    expect(roleRequiresMfa('inspector')).toBe(false);
    expect(resolveMfaSessionDecision('inspector', {
      verified: false,
      enrolledFactors: 0,
      emailVerified: false,
    })).toBe('none');
  });

  it('does not accept anything except verified session evidence for a privileged role', () => {
    expect(resolveMfaSessionDecision('proinspect_admin', {
      verified: true,
      enrolledFactors: 1,
      emailVerified: true,
    })).toBe('none');
  });
});
