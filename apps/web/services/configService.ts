import appletConfig from '../../../firebase-applet-config.json';
import cloudflareConfig from '../../../firebase-cloudflare-config.json';

export interface RuntimeConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  enableCloudSync: boolean;
}

export interface FirebaseRuntimeConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  firestoreDatabaseId?: string;
  measurementId?: string;
}

const CONFIG_KEY = 'rbp_runtime_config';

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
  enableCloudSync: false,
};

const sanitizeString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const sanitizeRuntimeConfig = (value: Partial<RuntimeConfig> | null | undefined): RuntimeConfig => ({
  apiKey: sanitizeString(value?.apiKey),
  authDomain: sanitizeString(value?.authDomain),
  projectId: sanitizeString(value?.projectId),
  storageBucket: sanitizeString(value?.storageBucket),
  messagingSenderId: sanitizeString(value?.messagingSenderId),
  appId: sanitizeString(value?.appId),
  enableCloudSync: Boolean(value?.enableCloudSync),
});

export const getRuntimeConfig = (): RuntimeConfig => {
  if (typeof window === 'undefined') return DEFAULT_RUNTIME_CONFIG;

  try {
    const stored = window.localStorage.getItem(CONFIG_KEY);
    if (!stored) return DEFAULT_RUNTIME_CONFIG;
    return sanitizeRuntimeConfig(JSON.parse(stored));
  } catch {
    return DEFAULT_RUNTIME_CONFIG;
  }
};

export const saveRuntimeConfig = (config: RuntimeConfig): RuntimeConfig => {
  const sanitized = sanitizeRuntimeConfig(config);
  if (typeof window !== 'undefined') window.localStorage.setItem(CONFIG_KEY, JSON.stringify(sanitized));
  return sanitized;
};

export const clearRuntimeConfig = (): void => {
  if (typeof window !== 'undefined') window.localStorage.removeItem(CONFIG_KEY);
};

const hasCompleteFirebaseConfig = (config: FirebaseRuntimeConfig): boolean => Boolean(
  config.apiKey &&
  config.authDomain &&
  config.projectId &&
  config.storageBucket &&
  config.messagingSenderId &&
  config.appId
);

export const isRuntimeFirebaseFallbackAllowed = (): boolean => Boolean(import.meta.env.DEV);

export const getEnvFirebaseConfig = (): FirebaseRuntimeConfig => ({
  apiKey: sanitizeString(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: sanitizeString(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: sanitizeString(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: sanitizeString(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: sanitizeString(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: sanitizeString(import.meta.env.VITE_FIREBASE_APP_ID),
  ...(sanitizeString(import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID)
    ? { firestoreDatabaseId: sanitizeString(import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID) }
    : {}),
  ...(sanitizeString(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID)
    ? { measurementId: sanitizeString(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) }
    : {}),
});

export const getRuntimeFirebaseConfig = (): FirebaseRuntimeConfig => {
  const config = getRuntimeConfig();
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  };
};

function firebaseConfigFromSource(source: typeof appletConfig | typeof cloudflareConfig): FirebaseRuntimeConfig | undefined {
  if (!source || !source.apiKey || !source.projectId) return undefined;
  return {
    apiKey: source.apiKey,
    authDomain: source.authDomain,
    projectId: source.projectId,
    storageBucket: source.storageBucket,
    messagingSenderId: source.messagingSenderId,
    appId: source.appId,
    ...(source.firestoreDatabaseId ? { firestoreDatabaseId: source.firestoreDatabaseId } : {}),
    ...(source.measurementId ? { measurementId: source.measurementId } : {}),
  };
}

function getCloudflareFirebaseConfig(): FirebaseRuntimeConfig | undefined {
  return firebaseConfigFromSource(cloudflareConfig);
}

function getAppletFirebaseConfig(): FirebaseRuntimeConfig | undefined {
  return firebaseConfigFromSource(appletConfig);
}

export const getResolvedFirebaseConfig = (): FirebaseRuntimeConfig | undefined => {
  const envConfig = getEnvFirebaseConfig();
  if (hasCompleteFirebaseConfig(envConfig)) return envConfig;

  if (import.meta.env.PROD) {
    const productionConfig = getCloudflareFirebaseConfig();
    if (productionConfig && hasCompleteFirebaseConfig(productionConfig)) return productionConfig;
    return undefined;
  }

  if (import.meta.env.DEV) {
    const applet = getAppletFirebaseConfig();
    if (applet) return applet;

    const runtimeConfig = getRuntimeConfig();
    const runtimeFirebaseConfig = getRuntimeFirebaseConfig();
    if (runtimeConfig.enableCloudSync && hasCompleteFirebaseConfig(runtimeFirebaseConfig)) return runtimeFirebaseConfig;
  }

  return undefined;
};

export const getFirebaseConfig = (): FirebaseRuntimeConfig => getResolvedFirebaseConfig() || getRuntimeFirebaseConfig();

let cachedAiStatus = true;

export const checkAiStatus = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/v1/analysis/status');
    if (res.ok) {
      const json = await res.json();
      cachedAiStatus = Boolean(json?.data?.available);
    }
  } catch {
    cachedAiStatus = false;
  }
  return cachedAiStatus;
};

export const getGeminiApiKey = (): string => '';
export const isAiConfigured = (): boolean => cachedAiStatus;
export const isCloudSyncEnabled = (): boolean => Boolean(getResolvedFirebaseConfig());
export const isFirebaseConfigured = (): boolean => Boolean(getResolvedFirebaseConfig());
