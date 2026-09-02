import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendAppwritePasswordRecovery } from '../../services/appwriteAuth';

const AppwriteForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendAppwritePasswordRecovery(email.trim());
      setSent(true);
    } catch {
      setError('Password recovery could not be requested. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">ProInspect Auth</div>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-500">Enter the email address associated with your Appwrite account.</p>
        {!sent && <><label className="mt-5 grid gap-1.5 text-sm font-semibold text-slate-700">Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5" required /></label>{error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}<button type="submit" disabled={busy} className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Send recovery email</button></>}
        {sent && <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">If the account exists, Appwrite has sent a recovery link.</p>}
        <Link to="/auth/login" className="mt-5 inline-flex text-sm font-semibold text-indigo-700">Return to sign in</Link>
      </form>
    </main>
  );
};

export default AppwriteForgotPasswordPage;
