import React, { useState } from 'react';
import { resetAppwritePassword } from '../../services/appwriteAuth';
import { AuthResultCard } from './AppwriteVerifyEmailPage';

const AppwriteResetPasswordPage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId')?.trim() ?? '';
  const secret = params.get('secret')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState<'form' | 'working' | 'passed' | 'failed'>(userId && secret ? 'form' : 'failed');
  const [message, setMessage] = useState(userId && secret ? '' : 'This recovery link is incomplete. Request a new password reset email.');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 12) {
      setMessage('Use a password with at least 12 characters.');
      return;
    }
    if (password !== confirmation) {
      setMessage('The password confirmation does not match.');
      return;
    }
    setResult('working');
    setMessage('Updating your password...');
    try {
      await resetAppwritePassword(userId, secret, password);
      setResult('passed');
      setMessage('Your password was updated. Sign in with the new password.');
    } catch {
      setResult('failed');
      setMessage('This recovery link is invalid or expired. Request a new password reset email.');
    }
  };

  if (result !== 'form') return <AuthResultCard title="Password recovery" result={result} message={message} />;
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">ProInspect Auth</div>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Choose a new password</h1>
        <p className="mt-2 text-sm text-slate-500">Use at least 12 characters and do not reuse a previous password.</p>
        <label className="mt-5 grid gap-1.5 text-sm font-semibold text-slate-700">New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5" required /></label>
        <label className="mt-4 grid gap-1.5 text-sm font-semibold text-slate-700">Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5" required /></label>
        {message && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{message}</p>}
        <button type="submit" className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Update password</button>
      </form>
    </main>
  );
};

export default AppwriteResetPasswordPage;
