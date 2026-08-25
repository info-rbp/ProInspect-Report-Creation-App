import {
  getMultiFactorResolver,
  multiFactor,
  sendEmailVerification,
  TotpMultiFactorGenerator,
  type User,
  type TotpSecret,
} from 'firebase/auth';
import { auth } from './storageService';

export type MfaFlowState = 'none' | 'challenge' | 'enrollment' | 'email-verification';

export interface TotpEnrollmentDetails {
  secretKey: string;
  qrCodeUrl: string;
  accountName: string;
  issuer: string;
}

let pendingResolver: ReturnType<typeof getMultiFactorResolver> | undefined;
let pendingTotpSecret: TotpSecret | undefined;

function firebaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isMultiFactorChallengeError(error: unknown): boolean {
  return firebaseErrorCode(error) === 'auth/multi-factor-auth-required';
}

export function captureMultiFactorChallenge(error: unknown): void {
  if (!auth) throw new Error('Identity Platform is not configured for this deployment.');
  if (!isMultiFactorChallengeError(error)) throw new Error('The supplied error is not an MFA challenge.');
  pendingResolver = getMultiFactorResolver(auth, error as Parameters<typeof getMultiFactorResolver>[1]);
}

export async function completePendingTotpSignIn(code: string): Promise<User> {
  const resolver = pendingResolver;
  if (!resolver) throw new Error('The MFA sign-in challenge has expired. Sign in again.');

  const hint = resolver.hints.find((item) => item.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) {
    throw new Error('This account does not have a supported authenticator-app factor enrolled.');
  }

  const verificationCode = code.trim();
  if (!/^\d{6}$/.test(verificationCode)) throw new Error('Enter the 6-digit code from your authenticator app.');

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, verificationCode);
  const credential = await resolver.resolveSignIn(assertion);
  pendingResolver = undefined;
  await credential.user.getIdToken(true);
  return credential.user;
}

export async function getMfaSessionState(user: User): Promise<{
  verified: boolean;
  enrolledFactors: number;
  emailVerified: boolean;
}> {
  const token = await user.getIdTokenResult(true);
  const firebaseClaim = token.claims.firebase as { sign_in_second_factor?: unknown } | undefined;
  const verified = typeof firebaseClaim?.sign_in_second_factor === 'string'
    || token.claims.mfa_verified === true;

  return {
    verified,
    enrolledFactors: multiFactor(user).enrolledFactors.length,
    emailVerified: user.emailVerified,
  };
}

export async function beginTotpEnrollment(user: User): Promise<TotpEnrollmentDetails> {
  if (!user.emailVerified) {
    throw new Error('Verify your email address before enrolling multi-factor authentication.');
  }

  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  pendingTotpSecret = secret;
  const accountName = user.email || user.uid;
  const issuer = 'ProInspect';

  return {
    secretKey: secret.secretKey,
    qrCodeUrl: secret.generateQrCodeUrl(accountName, issuer),
    accountName,
    issuer,
  };
}

export async function completeTotpEnrollment(user: User, code: string): Promise<void> {
  const secret = pendingTotpSecret;
  if (!secret) throw new Error('The MFA enrolment session has expired. Start setup again.');

  const verificationCode = code.trim();
  if (!/^\d{6}$/.test(verificationCode)) throw new Error('Enter the 6-digit code from your authenticator app.');

  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, verificationCode);
  await multiFactor(user).enroll(assertion, 'Authenticator app');
  pendingTotpSecret = undefined;
  await user.getIdToken(true);
}

export async function sendMfaEmailVerification(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export function clearPendingMfaState(): void {
  pendingResolver = undefined;
  pendingTotpSecret = undefined;
}
