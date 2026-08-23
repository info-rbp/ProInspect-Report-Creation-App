import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  LogIn,
  UserPlus,
  Building2,
  Sparkles,
} from 'lucide-react';

interface LoginPageProps {
  onLogin: (email: string, pass: string) => Promise<void>;
  onGoogleLogin?: () => Promise<void>;
  onRegister?: (email: string, pass: string) => Promise<void>;
  error?: string | null;
  isSubmitting?: boolean;
}

const LoginPage: React.FC<LoginPageProps> = ({
  onLogin,
  onGoogleLogin,
  onRegister,
  error,
  isSubmitting = false,
}) => {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('info@remotebusinesspartner.com.au');
  const [password, setPassword] = useState('Foxtrot19!');
  const [showPassword, setShowPassword] = useState(false);
  const [activeProvider, setActiveProvider] = useState<'google' | 'email' | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setActiveProvider('email');
    try {
      if (mode === 'register' && onRegister) {
        await onRegister(email.trim(), password);
      } else {
        await onLogin(email.trim(), password);
      }
    } finally {
      setActiveProvider(null);
    }
  };

  const handleGoogleClick = async () => {
    if (!onGoogleLogin) return;
    setActiveProvider('google');
    try {
      await onGoogleLogin();
    } finally {
      setActiveProvider(null);
    }
  };

  const setPreset = (presetEmail: string, presetPass: string) => {
    setEmail(presetEmail);
    setPassword(presetPass);
  };

  return (
    <div id="login-page-container" className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div id="login-card-wrapper" className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        {/* Card Header & Brand */}
        <div id="login-brand-header" className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-950 text-white shadow-md shadow-slate-900/10 mb-4 ring-1 ring-slate-800">
            <ShieldCheck className="w-7 h-7 text-indigo-400" />
          </div>
          <h1 id="login-title" className="text-2xl font-bold tracking-tight text-slate-900">
            ProInspect Portal
          </h1>
          <p id="login-subtitle" className="mt-1.5 text-sm text-slate-500">
            Commercial Property Condition &amp; Maintenance Platform
          </p>
        </div>

        {/* Main Card */}
        <div
          id="login-main-card"
          className="bg-white border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-200/60 p-6 sm:p-8"
        >
          {/* Google Sign In Button */}
          {onGoogleLogin && (
            <div id="login-google-section" className="mb-6">
              <button
                id="login-google-button"
                type="button"
                onClick={handleGoogleClick}
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold border border-slate-300 rounded-xl shadow-xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-slate-950 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {activeProvider === 'google' && isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                )}
                <span>Sign in with Google</span>
              </button>

              <div id="login-divider" className="relative my-6 text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wider">
                  <span className="bg-white px-3 text-slate-500 font-medium">Or credentials</span>
                </div>
              </div>
            </div>
          )}

          {/* Mode Switch Tabs */}
          {onRegister && (
            <div id="login-tabs" className="grid grid-cols-2 p-1 mb-5 bg-slate-100 rounded-xl text-xs font-semibold">
              <button
                id="login-tab-signin"
                type="button"
                onClick={() => setMode('signin')}
                className={`py-1.5 rounded-lg transition-all ${
                  mode === 'signin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                id="login-tab-register"
                type="button"
                onClick={() => setMode('register')}
                className={`py-1.5 rounded-lg transition-all ${
                  mode === 'register'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          {/* Error & Diagnostic Banner */}
          {error && (
            <div
              id="login-error-banner"
              className="mb-5 rounded-xl border border-red-200 bg-red-50/90 p-3.5 text-xs text-red-800 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">{error}</p>
                <p className="text-red-700 text-[11px]">
                  Tip: If your password was changed or unlinked, use Google Sign-in or switch to "Create Account" with your email.
                </p>
              </div>
            </div>
          )}

          {/* Form */}
          <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
            <div id="login-field-email">
              <label htmlFor="login-input-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-input-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@agency.com"
                  className="w-full pl-10 pr-3.5 py-2 text-sm text-slate-900 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                  required
                />
              </div>
            </div>

            <div id="login-field-password">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-input-password" className="block text-xs font-semibold text-slate-700">
                  Password
                </label>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-input-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2 text-sm text-slate-900 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                  required
                />
                <button
                  id="login-toggle-password"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              id="login-submit-button"
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-950 hover:bg-slate-900 text-white text-sm font-semibold rounded-xl shadow-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {activeProvider === 'email' && isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'register' ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Register &amp; Launch</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Sign In to ProInspect</span>
                </>
              )}
            </button>
          </form>

          {/* Quick Presets / Help */}
          <div id="login-preset-section" className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>Quick Account Presets</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                id="preset-user-rbp"
                type="button"
                onClick={() => setPreset('info@remotebusinesspartner.com.au', 'Foxtrot19!')}
                className="text-left px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 text-xs transition-colors"
              >
                <div className="font-medium text-slate-900 flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 text-indigo-600" />
                  <span>info@remotebusinesspartner.com.au</span>
                </div>
              </button>
              <button
                id="preset-user-proinspect"
                type="button"
                onClick={() => setPreset('info@proinspect.systems', 'Foxtrot19!')}
                className="text-left px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 text-xs transition-colors"
              >
                <div className="font-medium text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3 text-slate-700" />
                  <span>info@proinspect.systems</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <p id="login-footer-text" className="text-center text-xs text-slate-600 mt-6">
          Authorized personnel only. Protected under Property Condition Report &amp; Commercial Agency policies.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;

