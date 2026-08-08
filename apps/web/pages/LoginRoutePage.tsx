import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoginPage from '../components/LoginPage';
import { useAuth } from '../contexts/AuthContext';

const LoginRoutePage: React.FC = () => {
  const { isAuthenticated, isLoadingAuth, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  if (isLoadingAuth) return <div className="min-h-screen grid place-items-center text-sm text-gray-500">Loading...</div>;
  if (isAuthenticated) return <Navigate to="/app/dashboard" replace state={{ from: location }} />;

  const handleLogin = async (email: string, password: string) => {
    setError(null);
    try {
      await login(email, password);
    } catch {
      setError('Sign-in failed. Check your credentials or contact your agency administrator.');
    }
  };

  return <LoginPage onLogin={handleLogin} error={error} />;
};

export default LoginRoutePage;
