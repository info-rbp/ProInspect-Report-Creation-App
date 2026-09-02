import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyAppwriteEmail } from '../../services/appwriteAuth';

const AppwriteVerifyEmailPage: React.FC = () => {
  const [params] = useSearchParams();
  const [result, setResult] = useState<'working' | 'passed' | 'failed'>('working');
  const [message, setMessage] = useState('Verifying your email address...');

  useEffect(() => {
    const userId = params.get('userId')?.trim();
    const secret = params.get('secret')?.trim();
    if (!userId || !secret) {
      setResult('failed');
      setMessage('This verification link is incomplete. Request a new email from the sign-in page.');
      return;
    }
    void verifyAppwriteEmail(userId, secret)
      .then(() => {
        setResult('passed');
        setMessage('Your email address is verified. Sign in again to continue.');
      })
      .catch(() => {
        setResult('failed');
        setMessage('This verification link is invalid or expired. Request a new email and try again.');
      });
  }, [params]);

  return <AuthResultCard title="Email verification" result={result} message={message} />;
};

export const AuthResultCard: React.FC<{
  title: string;
  result: 'working' | 'passed' | 'failed';
  message: string;
}> = ({ title, result, message }) => (
  <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">ProInspect Auth</div>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">{title}</h1>
      <p className={`mt-4 rounded-xl border p-4 text-sm ${result === 'failed' ? 'border-red-200 bg-red-50 text-red-800' : result === 'passed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{message}</p>
      {result !== 'working' && <Link to="/auth/login" className="mt-5 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Return to sign in</Link>}
    </section>
  </main>
);

export default AppwriteVerifyEmailPage;
