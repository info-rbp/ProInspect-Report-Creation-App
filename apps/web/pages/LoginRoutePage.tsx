import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import LoginPage from '../components/LoginPage';
import { useAuth } from '../contexts/AuthContext';

function formatAuthError(err: unknown): string {
  if (!err) return 'An unexpected error occurred during sign in.';
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) {
    return 'Invalid email or password. If you do not have an account yet, switch to "Create Account" or use "Sign in with Google".';
  }
  if (message.includes('auth/invalid-verification-code')) {
    return 'The authenticator code is invalid or has expired. Enter the current 6-digit code and try again.';
  }
  if (message.includes('auth/popup-closed-by-user')) {
    return 'The Google sign-in window was closed before completing.';
  }
  if (message.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists. Please sign in with your password or use Google Sign-in.';
  }
  if (message.includes('auth/weak-password')) {
    return 'Password should be at least 6 characters.';
  }
  if (message.includes('auth/operation-not-allowed')) {
    return 'This sign-in method is not enabled for the ProInspect Identity Platform project.';
  }
  if (message.includes('auth/network-request-failed')) {
    return 'Network connection error. Please check your internet connection and try again.';
  }

  return message.replace(/^Firebase:\s*/, '').replace(/\s*\([^)]*\)\.?$/, '') || 'Sign-in failed. Please check your credentials.';
}

interface MfaCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

const MfaCard: React.FC<MfaCardProps> = ({ title, description, children }) => (
  <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-950 text-white shadow-md shadow-slate-900/10 mb-4 ring-1 ring-slate-800">
          <ShieldCheck className="w-7 h-7 text-indigo-400" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-200/60 p-6 sm:p-8">
        {children}
      </div>
    </div>
  </div>
);

const LoginRoutePage: React.FC = () => {
  const {
    isAuthenticated,
    isLoadingAuth,
    mfaState,
    mfaEnrollmentDetails,
    login,
    loginWithGoogle,
    register,
    completeMfaLogin,
    beginMfaEnrollment,
    completeMfaEnrollment,
    sendMfaVerificationEmail,
    logout,
  } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (mfaState !== 'enrollment' || mfaEnrollmentDetails || enrollmentLoading) return;
    setEnrollmentLoading(true);
    setError(null);
    void beginMfaEnrollment()
      .catch((err) => setError(formatAuthError(err)))
      .finally(() => setEnrollmentLoading(false));
  }, [beginMfaEnrollment, enrollmentLoading, mfaEnrollmentDetails, mfaState]);

  if (isLoadingAuth) return <div className="min-h-screen grid place-items-center text-sm text-gray-500">Loading...</div>;
  if (isAuthenticated) return <Navigate to="/app/dashboard" replace state={{ from: location }} />;

  const handleLogin = async (email: string, password: string) => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (email: string, password: string) => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await register(email, password);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaChallenge = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await completeMfaLogin(verificationCode);
      setVerificationCode('');
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await completeMfaEnrollment(verificationCode);
      setVerificationCode('');
      setNotice('Multi-factor authentication is enrolled. Sign in again to verify your new authenticator factor.');
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendVerification = async () => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await sendMfaVerificationEmail();
      setNotice('Verification email sent. Open the link in that email, then return here and sign in again.');
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (mfaState === 'challenge') {
    return (
      <MfaCard
        title="Verify your sign-in"
        description="Enter the current code from the authenticator app linked to your ProInspect account."
      >
        <form onSubmit={handleMfaChallenge} className="space-y-5">
          <div>
            <label htmlFor="mfa-challenge-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
              6-digit authenticator code
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="mfa-challenge-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full pl-10 pr-3.5 py-2.5 text-lg tracking-[0.35em] font-mono text-slate-900 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-600"
                required
                autoFocus
              />
            </div>
          </div>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
          <button
            type="submit"
            disabled={isSubmitting || verificationCode.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-950 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Verify and continue
          </button>
          <button type="button" onClick={() => void logout()} className="w-full text-xs font-semibold text-slate-500 hover:text-slate-800">
            Cancel and sign out
          </button>
        </form>
      </MfaCard>
    );
  }

  if (mfaState === 'email-verification') {
    return (
      <MfaCard
        title="Verify your email first"
        description="Identity Platform requires a verified email address before a privileged ProInspect account can enrol MFA."
      >
        <div className="space-y-5 text-sm text-slate-600">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
            <MailCheck className="w-5 h-5 text-amber-700 shrink-0" />
            <p>Send a verification email, open its link, then sign out and sign back in before continuing MFA setup.</p>
          </div>
          {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
          <button
            type="button"
            onClick={handleSendVerification}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-950 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Send verification email
          </button>
          <button type="button" onClick={() => void logout()} className="w-full text-xs font-semibold text-slate-500 hover:text-slate-800">
            Sign out
          </button>
        </div>
      </MfaCard>
    );
  }

  if (mfaState === 'enrollment') {
    return (
      <MfaCard
        title="Secure your privileged account"
        description="Super Admin, ProInspect Admin and Reviewer accounts require an authenticator-app second factor."
      >
        <form onSubmit={handleMfaEnrollment} className="space-y-5">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950 space-y-3">
            <div className="flex gap-3">
              <ShieldCheck className="w-5 h-5 text-indigo-700 shrink-0" />
              <div>
                <p className="font-semibold">Add ProInspect to your authenticator app</p>
                <p className="mt-1 text-xs text-indigo-800">Choose to add an account manually, then enter the secret key below as a time-based (TOTP) key.</p>
              </div>
            </div>
            {enrollmentLoading && (
              <div className="flex items-center gap-2 text-xs"><Loader2 className="w-4 h-4 animate-spin" />Generating secure enrolment secret...</div>
            )}
            {mfaEnrollmentDetails && (
              <>
                <div>
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-indigo-700">Account</div>
                  <div className="mt-1 font-mono text-xs break-all">{mfaEnrollmentDetails.accountName}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-indigo-700">Secret key</div>
                  <div className="mt-1 rounded-lg bg-white border border-indigo-200 p-3 font-mono text-sm tracking-wider break-all select-all">
                    {mfaEnrollmentDetails.secretKey}
                  </div>
                </div>
              </>
            )}
          </div>

          <div>
            <label htmlFor="mfa-enrollment-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Enter the current 6-digit code to confirm setup
            </label>
            <input
              id="mfa-enrollment-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full px-3.5 py-2.5 text-lg tracking-[0.35em] font-mono text-slate-900 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-600"
              required
            />
          </div>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
          <button
            type="submit"
            disabled={isSubmitting || !mfaEnrollmentDetails || verificationCode.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-950 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Complete MFA setup
          </button>
          <button type="button" onClick={() => void logout()} className="w-full text-xs font-semibold text-slate-500 hover:text-slate-800">
            Cancel and sign out
          </button>
        </form>
      </MfaCard>
    );
  }

  return (
    <>
      {notice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 shadow-lg">
          {notice}
        </div>
      )}
      <LoginPage
        onLogin={handleLogin}
        onGoogleLogin={handleGoogleLogin}
        onRegister={handleRegister}
        error={error}
        isSubmitting={isSubmitting}
      />
    </>
  );
};

export default LoginRoutePage;
