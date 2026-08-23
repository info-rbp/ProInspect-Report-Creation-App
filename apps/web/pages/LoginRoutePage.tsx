import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import LoginPage from '../components/LoginPage';
import { useAuth } from '../contexts/AuthContext';

function formatAuthError(err: unknown): string {
  if (!err) return 'An unexpected error occurred during sign in.';
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) {
    return 'Invalid email or password. If you do not have an account yet, switch to "Create Account" or use "Sign in with Google".';
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
    return 'Email/password sign-in is not enabled in Firebase. Please use "Sign in with Google" or enable Email/Password in your Firebase Console.';
  }
  if (message.includes('auth/network-request-failed')) {
    return 'Network connection error. Please check your internet connection and try again.';
  }

  return message.replace(/^Firebase:\s*/, '').replace(/\s*\([^)]*\)\.?$/, '') || 'Sign-in failed. Please check your credentials.';
}

const LoginRoutePage: React.FC = () => {
  const { isAuthenticated, isLoadingAuth, login, loginWithGoogle, register } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const location = useLocation();

  if (isLoadingAuth) return <div className="min-h-screen grid place-items-center text-sm text-gray-500">Loading...</div>;
  if (isAuthenticated) return <Navigate to="/app/dashboard" replace state={{ from: location }} />;

  const handleLogin = async (email: string, password: string) => {
    setError(null);
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
    setIsSubmitting(true);
    try {
      await register(email, password);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <LoginPage
      onLogin={handleLogin}
      onGoogleLogin={handleGoogleLogin}
      onRegister={handleRegister}
      error={error}
      isSubmitting={isSubmitting}
    />
  );
};

export default LoginRoutePage;

