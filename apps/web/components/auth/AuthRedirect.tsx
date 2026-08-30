import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { defaultPortalRoute } from '../../services/platform/portalAccess';

const AuthRedirect: React.FC = () => {
  const { isAuthenticated, isLoadingAuth, userProfile } = useAuth();

  if (isLoadingAuth) {
    return <div className="min-h-screen grid place-items-center text-sm text-gray-500">Checking access...</div>;
  }

  return <Navigate to={isAuthenticated ? defaultPortalRoute(userProfile?.role as string | undefined) : '/auth/login'} replace />;
};

export default AuthRedirect;
