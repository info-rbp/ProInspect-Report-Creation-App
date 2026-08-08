import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import AccessDenied from '../layout/AccessDenied';
import { logAuditEvent } from '../../services/platform/auditService';
import type { InternalSection } from '../../services/platform/roleAccess';
import type { UserRole } from '../../types/platform';

interface RoleProtectedRouteProps {
  section?: InternalSection;
  roles?: UserRole[];
}

const RoleProtectedRoute: React.FC<RoleProtectedRouteProps> = ({ section, roles }) => {
  const { currentUser, userProfile, canAccess, hasRole } = useAuth();
  const location = useLocation();
  const allowed = section ? canAccess(section) : roles ? hasRole(...roles) : true;

  useEffect(() => {
    if (allowed || !userProfile) {
      return;
    }

    logAuditEvent({
      agencyId: userProfile.agencyId,
      entityType: 'user',
      entityId: currentUser?.uid || userProfile.id,
      eventType: 'access_denied',
      actorId: currentUser?.uid,
      actorRole: userProfile.role,
      metadata: { path: location.pathname, section, roles },
    });
  }, [allowed, currentUser?.uid, location.pathname, roles, section, userProfile]);

  if (!allowed) {
    return <AccessDenied />;
  }

  return <Outlet />;
};

export default RoleProtectedRoute;
