import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import type { InternalSection } from '../services/platform/roleAccess';
import { canAccessSection, hasAnyRole } from '../services/platform/roleAccess';
import { ensureAppCheck } from '../services/appCheckService';
import {
  beginTotpEnrollment,
  captureMultiFactorChallenge,
  clearPendingMfaState,
  completePendingTotpSignIn,
  completeTotpEnrollment,
  getMfaSessionState,
  isMultiFactorChallengeError,
  requiresMfaRestart,
  sendMfaEmailVerification,
  type MfaFlowState,
  type TotpEnrollmentDetails,
} from '../services/mfaService';
import { resolveMfaSessionDecision, roleRequiresMfa } from '../services/mfaPolicy';
import { getOrCreateUserProfile } from '../services/platform/userProfileService';
import {
  listMyPortalEntitlements,
  type PortalEntitlementRecord,
} from '../services/platform/portalEntitlementService';
import {
  auth,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithEmailPassword,
  signInWithGoogle,
  signOutUser,
} from '../services/storageService';
import type { UserProfile, UserRole } from '../types/platform';

interface AuthContextValue {
  currentUser: User | null;
  userProfile: UserProfile | null;
  portalEntitlements: readonly PortalEntitlementRecord[];
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  isLoadingPortalEntitlements: boolean;
  mfaState: MfaFlowState;
  mfaEnrollmentDetails: TotpEnrollmentDetails | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  completeMfaLogin: (code: string) => Promise<void>;
  beginMfaEnrollment: () => Promise<TotpEnrollmentDetails>;
  completeMfaEnrollment: (code: string) => Promise<void>;
  sendMfaVerificationEmail: () => Promise<void>;
  refreshPortalEntitlements: () => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  canAccess: (section: InternalSection) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [portalEntitlements, setPortalEntitlements] = useState<PortalEntitlementRecord[]>([]);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPortalEntitlements, setIsLoadingPortalEntitlements] = useState(false);
  const [mfaState, setMfaState] = useState<MfaFlowState>('none');
  const [mfaVerified, setMfaVerified] = useState(false);
  const [mfaEnrollmentDetails, setMfaEnrollmentDetails] = useState<TotpEnrollmentDetails | null>(null);

  const clearLocalAuth = () => {
    clearPendingMfaState();
    setCurrentUser(null);
    setUserProfile(null);
    setPortalEntitlements([]);
    setIsLoadingPortalEntitlements(false);
    setMfaVerified(false);
    setMfaState('none');
    setMfaEnrollmentDetails(null);
  };

  const refreshPortalEntitlements = useCallback(async (): Promise<void> => {
    if (!auth?.currentUser) {
      setPortalEntitlements([]);
      return;
    }
    setIsLoadingPortalEntitlements(true);
    try {
      setPortalEntitlements(await listMyPortalEntitlements());
    } catch (error) {
      // During the bounded migration, legacy internal roles remain usable even if the
      // entitlement endpoint is not activated yet. Scoped portal users fail closed in
      // portalAccess because no entitlement is present.
      console.warn('Portal entitlements could not be refreshed.', error);
      setPortalEntitlements([]);
    } finally {
      setIsLoadingPortalEntitlements(false);
    }
  }, []);

  const applyAuthenticatedUser = async (firebaseUser: User): Promise<void> => {
    const profile = await getOrCreateUserProfile(firebaseUser);
    const session = await getMfaSessionState(firebaseUser);
    const decision = resolveMfaSessionDecision(profile.role, session);

    setCurrentUser(firebaseUser);
    setUserProfile(profile);
    setMfaVerified(session.verified);
    setMfaEnrollmentDetails(null);

    if (decision === 'none') {
      setMfaState('none');
      await refreshPortalEntitlements();
      return;
    }

    setPortalEntitlements([]);
    if (decision === 'email-verification') {
      setMfaState('email-verification');
      return;
    }
    if (decision === 'enrollment') {
      setMfaState('enrollment');
      return;
    }

    // A privileged user with enrolled factors but no verified second-factor claim
    // must establish a new second-factor session before portal context is exposed.
    await signOutUser();
    clearLocalAuth();
    throw new Error('Your privileged session requires multi-factor authentication. Sign in again to continue.');
  };

  useEffect(() => {
    if (!auth || !isFirebaseConfigured()) {
      clearLocalAuth();
      setIsLoadingAuth(false);
      return;
    }

    ensureAppCheck();
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        clearLocalAuth();
        setIsLoadingAuth(false);
        return;
      }

      try {
        await applyAuthenticatedUser(firebaseUser);
      } catch (error) {
        console.error('Failed to resolve an authorised authenticated session.', error);
        try { await signOutUser(); } catch { /* local state is cleared below */ }
        clearLocalAuth();
      } finally {
        setIsLoadingAuth(false);
      }
    });
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    if (!auth || !isFirebaseConfigured()) throw new Error('Identity Platform must be configured before signing in.');
    ensureAppCheck();
    setMfaEnrollmentDetails(null);
    try {
      const firebaseUser = await signInWithEmailPassword(email.trim(), password);
      await applyAuthenticatedUser(firebaseUser);
    } catch (error) {
      if (isMultiFactorChallengeError(error)) {
        captureMultiFactorChallenge(error);
        setMfaState('challenge');
        setCurrentUser(null);
        setUserProfile(null);
        setPortalEntitlements([]);
        setMfaVerified(false);
        return;
      }
      throw error;
    }
  };

  const loginWithGoogleUser = async (): Promise<void> => {
    if (!auth || !isFirebaseConfigured()) throw new Error('Identity Platform must be configured before signing in.');
    ensureAppCheck();
    setMfaEnrollmentDetails(null);
    try {
      const firebaseUser = await signInWithGoogle();
      await applyAuthenticatedUser(firebaseUser);
    } catch (error) {
      if (isMultiFactorChallengeError(error)) {
        captureMultiFactorChallenge(error);
        setMfaState('challenge');
        setCurrentUser(null);
        setUserProfile(null);
        setPortalEntitlements([]);
        setMfaVerified(false);
        return;
      }
      throw error;
    }
  };

  const completeMfaLogin = async (code: string): Promise<void> => {
    try {
      const firebaseUser = await completePendingTotpSignIn(code);
      await applyAuthenticatedUser(firebaseUser);
    } catch (error) {
      if (requiresMfaRestart(error)) {
        setMfaState('none');
        setCurrentUser(null);
        setUserProfile(null);
        setPortalEntitlements([]);
        setMfaVerified(false);
      }
      throw error;
    }
  };

  const beginMfaEnrollment = async (): Promise<TotpEnrollmentDetails> => {
    if (!currentUser || mfaState !== 'enrollment') throw new Error('There is no active MFA enrolment session.');
    const details = await beginTotpEnrollment(currentUser);
    setMfaEnrollmentDetails(details);
    return details;
  };

  const completeMfaEnrollment = async (code: string): Promise<void> => {
    if (!currentUser || mfaState !== 'enrollment') throw new Error('There is no active MFA enrolment session.');
    try {
      await completeTotpEnrollment(currentUser, code);
    } catch (error) {
      if (requiresMfaRestart(error)) setMfaEnrollmentDetails(null);
      throw error;
    }
    await signOutUser();
    clearLocalAuth();
  };

  const sendMfaVerificationEmail = async (): Promise<void> => {
    if (!currentUser || mfaState !== 'email-verification') throw new Error('There is no authenticated user awaiting email verification.');
    await sendMfaEmailVerification(currentUser);
  };

  const logout = async (): Promise<void> => {
    if (auth) await signOutUser();
    clearLocalAuth();
  };

  const value = useMemo<AuthContextValue>(() => ({
    currentUser,
    userProfile,
    portalEntitlements,
    isAuthenticated: Boolean(
      currentUser
      && userProfile?.status === 'active'
      && mfaState === 'none'
      && (!roleRequiresMfa(userProfile.role) || mfaVerified),
    ),
    isLoadingAuth,
    isLoadingPortalEntitlements,
    mfaState,
    mfaEnrollmentDetails,
    login,
    loginWithGoogle: loginWithGoogleUser,
    completeMfaLogin,
    beginMfaEnrollment,
    completeMfaEnrollment,
    sendMfaVerificationEmail,
    refreshPortalEntitlements,
    logout,
    hasRole: (...roles) => hasAnyRole(userProfile?.role, roles),
    canAccess: (section) => canAccessSection(userProfile?.role, section),
  }), [currentUser, isLoadingAuth, isLoadingPortalEntitlements, mfaEnrollmentDetails, mfaState, mfaVerified, portalEntitlements, refreshPortalEntitlements, userProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
};
