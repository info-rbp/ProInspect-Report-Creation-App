import React, { useState } from 'react';

interface LoginPageProps {
  onLogin: (email: string, pass: string) => Promise<void>;
  error?: string | null;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, error }) => {
  const [email, setEmail] = useState('info@proinspect.systems');
  const [password, setPassword] = useState('Foxtrot19!');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void onLogin(email, password);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded bg-gray-950 text-sm font-black text-white">PI</div>
          <h1 className="text-2xl font-bold text-gray-950">ProInspect</h1>
          <p className="text-sm text-gray-500">Sign in with your invited agency account</p>
        </div>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-gray-700">Email</label>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full mt-1 mb-4 p-2 border border-gray-300 rounded-md" required />
          <label className="block text-sm font-medium text-gray-700">Password</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full mt-1 mb-6 p-2 border border-gray-300 rounded-md" required />
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">Sign in</button>
        </form>
        <p className="text-center text-xs text-gray-500 mt-4">Accounts are invitation-only. Contact your agency administrator for access.</p>
      </div>
    </div>
  );
};

export default LoginPage;
