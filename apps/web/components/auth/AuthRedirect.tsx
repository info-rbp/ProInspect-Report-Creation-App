import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const AuthRedirect: React.FC = () => {
  const { isAuthenticated, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return <div className="min-h-screen grid place-items-center text-sm text-gray-500">Checking access...</div>;
  }

  return <Navigate to={isAuthenticated ? '/app/dashboard' : '/auth/login'} replace />;
};

export default AuthRedirect;
