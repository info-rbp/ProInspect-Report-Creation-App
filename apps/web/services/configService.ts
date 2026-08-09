import appletConfig from '../../../firebase-applet-config.json';

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
  if (typeof window === 'undefined') {
    return DEFAULT_RUNTIME_CONFIG;
  }

  try {
    const stored = window.localStorage.getItem(CONFIG_KEY);
    if (!stored) {
      return DEFAULT_RUNTIME_CONFIG;
    }

    return sanitizeRuntimeConfig(JSON.parse(stored));
  } catch {
    return DEFAULT_RUNTIME_CONFIG;
  }
};

export const saveRuntimeConfig = (config: RuntimeConfig): RuntimeConfig => {
  const sanitized = sanitizeRuntimeConfig(config);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(sanitized));
  }

  return sanitized;
};

export const clearRuntimeConfig = (): void => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(CONFIG_KEY);
  }
};

const hasCompleteFirebaseConfig = (config: FirebaseRuntimeConfig): boolean => Boolean(
  config.apiKey &&
  config.authDomain &&
  config.projectId &&
  config.storageBucket &&
  config.messagingSenderId &&
  config.appId
);

export const isRuntimeFirebaseFallbackAllowed = (): boolean => {
  return Boolean(import.meta.env.DEV);
};

export const getEnvFirebaseConfig = (): FirebaseRuntimeConfig => ({
  apiKey: sanitizeString(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: sanitizeString(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: sanitizeString(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: sanitizeString(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: sanitizeString(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: sanitizeString(import.meta.env.VITE_FIREBASE_APP_ID),
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

export const getResolvedFirebaseConfig = (): FirebaseRuntimeConfig | undefined => {
  if (appletConfig && appletConfig.apiKey && appletConfig.projectId) {
    return {
      apiKey: appletConfig.apiKey,
      authDomain: appletConfig.authDomain,
      projectId: appletConfig.projectId,
      storageBucket: appletConfig.storageBucket,
      messagingSenderId: appletConfig.messagingSenderId,
      appId: appletConfig.appId,
      firestoreDatabaseId: appletConfig.firestoreDatabaseId || undefined,
    };
  }

  const envConfig = getEnvFirebaseConfig();
  if (hasCompleteFirebaseConfig(envConfig)) {
    return envConfig;
  }

  const runtimeConfig = getRuntimeConfig();
  const runtimeFirebaseConfig = getRuntimeFirebaseConfig();

  // TODO: Remove this fallback after deployment environments are the only Firebase config source.
  if (isRuntimeFirebaseFallbackAllowed() && runtimeConfig.enableCloudSync && hasCompleteFirebaseConfig(runtimeFirebaseConfig)) {
    return runtimeFirebaseConfig;
  }

  return undefined;
};

export const getFirebaseConfig = (): FirebaseRuntimeConfig => {
  return getResolvedFirebaseConfig() || getRuntimeFirebaseConfig();
};

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

export const isCloudSyncEnabled = (): boolean => {
  return Boolean(getResolvedFirebaseConfig());
};

export const isFirebaseConfigured = (): boolean => Boolean(getResolvedFirebaseConfig());
