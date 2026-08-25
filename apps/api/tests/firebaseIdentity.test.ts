import { describe, expect, it } from 'vitest';
import { hasVerifiedFirebaseSecondFactor } from '../src/security/firebaseIdentity.js';

describe('Firebase identity MFA evidence', () => {
  it('recognises the Firebase TOTP second-factor claim', () => {
    expect(hasVerifiedFirebaseSecondFactor({
      firebase: { sign_in_second_factor: 'totp' },
    })).toBe(true);
  });

  it('does not accept an absent, blank or unrelated custom MFA flag', () => {
    expect(hasVerifiedFirebaseSecondFactor({})).toBe(false);
    expect(hasVerifiedFirebaseSecondFactor({ firebase: { sign_in_second_factor: '  ' } })).toBe(false);
    expect(hasVerifiedFirebaseSecondFactor({
      firebase: {},
      mfa_verified: true,
    } as { firebase: Record<string, never>; mfa_verified: boolean })).toBe(false);
  });
});
