import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import type { InternalSection } from '../services/platform/roleAccess';
import { canAccessSection, hasAnyRole } from '../services/platform/roleAccess';
import { ensureAppCheck } from '../services/appCheckService';
import { getOrCreateUserProfile } from '../services/platform/userProfileService';
import {
  auth,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithEmailPassword,
  signInWithGoogle,
  registerWithEmailPassword,
  signOutUser,
} from '../services/storageService';
import type { UserProfile, UserRole } from '../types/platform';

interface AuthContextValue {
  currentUser: User | null;
  userProfile: UserProfile | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  canAccess: (section: InternalSection) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    if (!auth || !isFirebaseConfigured()) {
      setCurrentUser(null);
      setUserProfile(null);
      setIsLoadingAuth(false);
      return;
    }

    ensureAppCheck();
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setCurrentUser(null);
        setUserProfile(null);
        setIsLoadingAuth(false);
        return;
      }

      try {
        const profile = await getOrCreateUserProfile(firebaseUser);
        setCurrentUser(firebaseUser);
        setUserProfile(profile);
      } catch (error) {
        console.error('Failed to resolve an authorised agency membership.', error);
        try {
          await signOutUser();
        } catch {
          // Authentication state is cleared locally below even if remote sign-out fails.
        }
        setCurrentUser(null);
        setUserProfile(null);
      } finally {
        setIsLoadingAuth(false);
      }
    });
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    if (!auth || !isFirebaseConfigured()) {
      throw new Error('Identity Platform must be configured before signing in.');
    }

    ensureAppCheck();
    const firebaseUser = await signInWithEmailPassword(email.trim(), password);
    try {
      const profile = await getOrCreateUserProfile(firebaseUser);
      setCurrentUser(firebaseUser);
      setUserProfile(profile);
    } catch (error) {
      try {
        await signOutUser();
      } catch {
        // Preserve the original membership error.
      }
      setCurrentUser(null);
      setUserProfile(null);
      throw error;
    }
  };

  const loginWithGoogleUser = async (): Promise<void> => {
    if (!auth || !isFirebaseConfigured()) {
      throw new Error('Identity Platform must be configured before signing in.');
    }

    ensureAppCheck();
    const firebaseUser = await signInWithGoogle();
    try {
      const profile = await getOrCreateUserProfile(firebaseUser);
      setCurrentUser(firebaseUser);
      setUserProfile(profile);
    } catch (error) {
      try {
        await signOutUser();
      } catch {
        // Preserve the original error.
      }
      setCurrentUser(null);
      setUserProfile(null);
      throw error;
    }
  };

  const registerUser = async (email: string, password: string): Promise<void> => {
    if (!auth || !isFirebaseConfigured()) {
      throw new Error('Identity Platform must be configured before signing in.');
    }

    ensureAppCheck();
    const firebaseUser = await registerWithEmailPassword(email.trim(), password);
    try {
      const profile = await getOrCreateUserProfile(firebaseUser);
      setCurrentUser(firebaseUser);
      setUserProfile(profile);
    } catch (error) {
      try {
        await signOutUser();
      } catch {
        // Preserve error
      }
      setCurrentUser(null);
      setUserProfile(null);
      throw error;
    }
  };

  const logout = async (): Promise<void> => {
    if (auth) await signOutUser();
    setCurrentUser(null);
    setUserProfile(null);
  };

  const value = useMemo<AuthContextValue>(() => ({
    currentUser,
    userProfile,
    isAuthenticated: Boolean(currentUser && userProfile?.status === 'active'),
    isLoadingAuth,
    login,
    loginWithGoogle: loginWithGoogleUser,
    register: registerUser,
    logout,
    hasRole: (...roles) => hasAnyRole(userProfile?.role, roles),
    canAccess: (section) => canAccessSection(userProfile?.role, section),
  }), [currentUser, isLoadingAuth, userProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
};
