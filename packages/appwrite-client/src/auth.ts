import { AuthenticationFactor, AuthenticatorType, type Account, type Models } from 'appwrite';

export function createEmailPasswordSession(account: Account, email: string, password: string): Promise<Models.Session> {
  return account.createEmailPasswordSession({ email: email.trim(), password });
}

export function requestEmailVerification(account: Account, returnUrl: string): Promise<Models.Token> {
  return account.createEmailVerification({ url: returnUrl });
}

export function requestPasswordRecovery(account: Account, email: string, returnUrl: string): Promise<Models.Token> {
  return account.createRecovery({ email: email.trim(), url: returnUrl });
}

export function currentAccount(account: Account): Promise<Models.User<Models.Preferences>> {
  return account.get();
}

export function completeEmailVerification(account: Account, userId: string, secret: string): Promise<Models.Token> {
  return account.updateEmailVerification({ userId, secret });
}

export function completePasswordRecovery(account: Account, userId: string, secret: string, password: string): Promise<Models.Token> {
  return account.updateRecovery({ userId, secret, password });
}

export function logoutCurrentSession(account: Account): Promise<unknown> {
  return account.deleteSession({ sessionId: 'current' });
}

export function beginTotpEnrollment(account: Account): Promise<Models.MfaType> {
  return account.createMFAAuthenticator({ type: AuthenticatorType.Totp });
}

export function verifyTotpEnrollment(account: Account, otp: string): Promise<Models.User<Models.Preferences>> {
  return account.updateMFAAuthenticator({ type: AuthenticatorType.Totp, otp });
}

export function enableMfa(account: Account): Promise<Models.User<Models.Preferences>> {
  return account.updateMFA({ mfa: true });
}

export function createMfaRecoveryCodes(account: Account): Promise<Models.MfaRecoveryCodes> {
  return account.createMFARecoveryCodes();
}

export function beginTotpChallenge(account: Account): Promise<Models.MfaChallenge> {
  return account.createMFAChallenge({ factor: AuthenticationFactor.Totp });
}

export function completeMfaChallenge(account: Account, challengeId: string, otp: string): Promise<Models.Session> {
  return account.updateMFAChallenge({ challengeId, otp });
}
