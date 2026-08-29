import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from 'appwrite';
import {
  beginTotpChallenge,
  beginTotpEnrollment,
  completeEmailVerification,
  completeMfaChallenge,
  completePasswordRecovery,
  createMfaRecoveryCodes,
  enableMfa,
  logoutCurrentSession,
  requestEmailVerification,
} from '../src/auth.js';

describe('Appwrite authentication lifecycle helpers', () => {
  it('uses approved return URLs and exposes completion and logout operations', async () => {
    const account = {
      createEmailVerification: vi.fn().mockResolvedValue({}),
      updateEmailVerification: vi.fn().mockResolvedValue({}),
      updateRecovery: vi.fn().mockResolvedValue({}),
      deleteSession: vi.fn().mockResolvedValue({}),
    } as unknown as Account;
    const nextPassword = randomUUID();
    await requestEmailVerification(account, 'http://localhost:5173/auth/verify');
    await completeEmailVerification(account, 'user-1', 'verification-token');
    await completePasswordRecovery(account, 'user-1', 'recovery-token', nextPassword);
    await logoutCurrentSession(account);
    expect(account.createEmailVerification).toHaveBeenCalledWith({ url: 'http://localhost:5173/auth/verify' });
    expect(account.updateEmailVerification).toHaveBeenCalledWith({ userId: 'user-1', secret: 'verification-token' });
    expect(account.updateRecovery).toHaveBeenCalledWith({ userId: 'user-1', secret: 'recovery-token', password: nextPassword });
    expect(account.deleteSession).toHaveBeenCalledWith({ sessionId: 'current' });
  });

  it('uses TOTP for enrolment and challenge and exposes recovery-code generation', async () => {
    const account = {
      createMFAAuthenticator: vi.fn().mockResolvedValue({}),
      updateMFA: vi.fn().mockResolvedValue({}),
      createMFARecoveryCodes: vi.fn().mockResolvedValue({ recoveryCodes: [] }),
      createMFAChallenge: vi.fn().mockResolvedValue({ $id: 'challenge-1' }),
      updateMFAChallenge: vi.fn().mockResolvedValue({}),
    } as unknown as Account;
    await beginTotpEnrollment(account);
    await enableMfa(account);
    await createMfaRecoveryCodes(account);
    await beginTotpChallenge(account);
    await completeMfaChallenge(account, 'challenge-1', '123456');
    expect(account.createMFAAuthenticator).toHaveBeenCalledWith({ type: 'totp' });
    expect(account.updateMFA).toHaveBeenCalledWith({ mfa: true });
    expect(account.createMFAChallenge).toHaveBeenCalledWith({ factor: 'totp' });
    expect(account.updateMFAChallenge).toHaveBeenCalledWith({ challengeId: 'challenge-1', otp: '123456' });
  });
});
