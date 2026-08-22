import { getApp, type FirebaseApp } from 'firebase/app';
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

let appCheck: AppCheck | undefined;
let initialisationAttempted = false;

export function ensureAppCheck(app: FirebaseApp = getApp()): AppCheck | undefined {
  if (appCheck) return appCheck;
  if (initialisationAttempted) return undefined;
  initialisationAttempted = true;

  const siteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim();
  if (!siteKey) return undefined;

  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return appCheck;
  } catch (error) {
    console.error('Firebase App Check initialization failed.', error);
    return undefined;
  }
}

export async function getAppCheckToken(): Promise<string | undefined> {
  const instance = ensureAppCheck();
  if (!instance) return undefined;
  return (await getToken(instance)).token;
}

export function isAppCheckConfigured(): boolean {
  return Boolean(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim());
}
