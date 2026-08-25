import type { IdTokenResult, User } from 'firebase/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  getMultiFactorResolver: vi.fn(),
  multiFactor: vi.fn(),
  sendEmailVerification: vi.fn(),
  assertionForEnrollment: vi.fn((secret, code) => ({ kind: 'enrolment', secret, code })),
  assertionForSignIn: vi.fn((uid, code) => ({ kind: 'sign-in', uid, code })),
  generateSecret: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getMultiFactorResolver: firebaseMocks.getMultiFactorResolver,
  multiFactor: firebaseMocks.multiFactor,
  sendEmailVerification: firebaseMocks.sendEmailVerification,
  TotpMultiFactorGenerator: {
    FACTOR_ID: 'totp',
    assertionForEnrollment: firebaseMocks.assertionForEnrollment,
    assertionForSignIn: firebaseMocks.assertionForSignIn,
    generateSecret: firebaseMocks.generateSecret,
  },
}));

vi.mock('../services/storageService', () => ({ auth: { name: 'test-auth' } }));

import {
  beginTotpEnrollment,
  captureMultiFactorChallenge,
  clearPendingMfaState,
  completePendingTotpSignIn,
  completeTotpEnrollment,
  getMfaSessionState,
} from '../services/mfaService';

function idTokenResult(claims: IdTokenResult['claims']): IdTokenResult {
  return {
    token: 'test-token',
    claims,
    authTime: '2026-08-25T00:00:00.000Z',
    issuedAtTime: '2026-08-25T00:00:00.000Z',
    expirationTime: '2026-08-25T01:00:00.000Z',
    signInProvider: 'password',
    signInSecondFactor: null,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    uid: 'user-1',
    email: 'person@example.com',
    emailVerified: true,
    getIdToken: vi.fn(async () => 'refreshed-token'),
    getIdTokenResult: vi.fn(async () => idTokenResult({})),
    ...overrides,
  } as unknown as User;
}

beforeEach(() => {
  clearPendingMfaState();
  vi.clearAllMocks();
});

describe('Firebase TOTP orchestration', () => {
  it('completes a TOTP sign-in challenge and force-refreshes the token', async () => {
    const firebaseUser = user();
    const resolver = {
      hints: [{ factorId: 'phone', uid: 'phone-factor' }, { factorId: 'totp', uid: 'totp-factor' }],
      resolveSignIn: vi.fn(async () => ({ user: firebaseUser })),
    };
    firebaseMocks.getMultiFactorResolver.mockReturnValue(resolver);

    captureMultiFactorChallenge({ code: 'auth/multi-factor-auth-required' });
    await expect(completePendingTotpSignIn('123456')).resolves.toBe(firebaseUser);

    expect(firebaseMocks.assertionForSignIn).toHaveBeenCalledWith('totp-factor', '123456');
    expect(resolver.resolveSignIn).toHaveBeenCalledOnce();
    expect(firebaseUser.getIdToken).toHaveBeenCalledWith(true);
  });

  it('keeps a valid challenge available after a wrong code so the user can retry', async () => {
    const firebaseUser = user();
    const resolver = {
      hints: [{ factorId: 'totp', uid: 'totp-factor' }],
      resolveSignIn: vi.fn()
        .mockRejectedValueOnce({ code: 'auth/invalid-verification-code' })
        .mockResolvedValueOnce({ user: firebaseUser }),
    };
    firebaseMocks.getMultiFactorResolver.mockReturnValue(resolver);

    captureMultiFactorChallenge({ code: 'auth/multi-factor-auth-required' });
    await expect(completePendingTotpSignIn('000000')).rejects.toThrow('invalid or has expired');
    await expect(completePendingTotpSignIn('123456')).resolves.toBe(firebaseUser);
  });

  it('clears an expired sign-in challenge and requires primary sign-in again', async () => {
    const resolver = {
      hints: [{ factorId: 'totp', uid: 'totp-factor' }],
      resolveSignIn: vi.fn().mockRejectedValue({ code: 'auth/invalid-multi-factor-session' }),
    };
    firebaseMocks.getMultiFactorResolver.mockReturnValue(resolver);

    captureMultiFactorChallenge({ code: 'auth/multi-factor-auth-required' });
    await expect(completePendingTotpSignIn('123456')).rejects.toThrow('challenge has expired');
    await expect(completePendingTotpSignIn('123456')).rejects.toThrow('challenge has expired');
    expect(resolver.resolveSignIn).toHaveBeenCalledOnce();
  });

  it('rejects a challenge that has no supported TOTP factor', async () => {
    firebaseMocks.getMultiFactorResolver.mockReturnValue({
      hints: [{ factorId: 'phone', uid: 'phone-factor' }],
      resolveSignIn: vi.fn(),
    });

    captureMultiFactorChallenge({ code: 'auth/multi-factor-auth-required' });
    await expect(completePendingTotpSignIn('123456')).rejects.toThrow('supported authenticator-app factor');
  });

  it('generates a ProInspect otpauth URL and completes enrolment', async () => {
    const firebaseUser = user();
    const secret = {
      secretKey: 'TEST-ONLY-SECRET',
      generateQrCodeUrl: vi.fn(() => 'otpauth://totp/ProInspect:person%40example.com?issuer=ProInspect'),
    };
    const factorUser = {
      enrolledFactors: [],
      getSession: vi.fn(async () => ({ session: 'first-factor-proof' })),
      enroll: vi.fn(async () => undefined),
    };
    firebaseMocks.multiFactor.mockReturnValue(factorUser);
    firebaseMocks.generateSecret.mockResolvedValue(secret);

    await expect(beginTotpEnrollment(firebaseUser)).resolves.toMatchObject({
      secretKey: 'TEST-ONLY-SECRET',
      issuer: 'ProInspect',
      qrCodeUrl: expect.stringMatching(/^otpauth:\/\//u),
    });
    await completeTotpEnrollment(firebaseUser, '654321');

    expect(secret.generateQrCodeUrl).toHaveBeenCalledWith('person@example.com', 'ProInspect');
    expect(firebaseMocks.assertionForEnrollment).toHaveBeenCalledWith(secret, '654321');
    expect(factorUser.enroll).toHaveBeenCalledWith(expect.anything(), 'Authenticator app');
    expect(firebaseUser.getIdToken).toHaveBeenCalledWith(true);
  });

  it('keeps the temporary enrolment secret after a wrong code so the user can retry', async () => {
    const firebaseUser = user();
    const secret = {
      secretKey: 'TEST-ONLY-SECRET',
      generateQrCodeUrl: vi.fn(() => 'otpauth://totp/ProInspect:test?issuer=ProInspect'),
    };
    const factorUser = {
      enrolledFactors: [],
      getSession: vi.fn(async () => ({ session: 'first-factor-proof' })),
      enroll: vi.fn()
        .mockRejectedValueOnce({ code: 'auth/invalid-verification-code' })
        .mockResolvedValueOnce(undefined),
    };
    firebaseMocks.multiFactor.mockReturnValue(factorUser);
    firebaseMocks.generateSecret.mockResolvedValue(secret);

    await beginTotpEnrollment(firebaseUser);
    await expect(completeTotpEnrollment(firebaseUser, '000000')).rejects.toThrow('invalid or has expired');
    await expect(completeTotpEnrollment(firebaseUser, '654321')).resolves.toBeUndefined();
    expect(factorUser.enroll).toHaveBeenCalledTimes(2);
  });

  it('requires verified email before generating an enrolment secret', async () => {
    await expect(beginTotpEnrollment(user({ emailVerified: false }))).rejects.toThrow('Verify your email');
    expect(firebaseMocks.generateSecret).not.toHaveBeenCalled();
  });

  it('only accepts Firebase second-factor token evidence, not a custom flag', async () => {
    const firebaseUser = user({
      getIdTokenResult: vi.fn(async () => idTokenResult({ mfa_verified: true })),
    });
    firebaseMocks.multiFactor.mockReturnValue({ enrolledFactors: [{ factorId: 'totp' }] });

    await expect(getMfaSessionState(firebaseUser)).resolves.toMatchObject({ verified: false });

    const verifiedUser = user({
      getIdTokenResult: vi.fn(async () => idTokenResult({
        firebase: { sign_in_second_factor: 'totp' },
      })),
    });
    await expect(getMfaSessionState(verifiedUser)).resolves.toMatchObject({ verified: true });
  });
});
