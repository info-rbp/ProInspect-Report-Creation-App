import {
  clearRuntimeConfig,
  getRuntimeConfig,
  isFirebaseConfigured,
  isAiConfigured,
  isCloudSyncEnabled,
  saveRuntimeConfig,
} from '../services/configService';

describe('configService', () => {
  beforeEach(() => {
    localStorage.clear();
    clearRuntimeConfig();
  });

  it('returns defaults when no config exists', () => {
    expect(getRuntimeConfig()).toEqual({
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
      geminiApiKey: '',
      enableCloudSync: false,
    });
  });

  it('persists sanitized config values', () => {
    saveRuntimeConfig({
      apiKey: ' firebase-key ',
      authDomain: ' project.firebaseapp.com ',
      projectId: ' my-project ',
      storageBucket: ' bucket ',
      messagingSenderId: ' sender ',
      appId: ' app-id ',
      geminiApiKey: ' gemini-key ',
      enableCloudSync: true,
    });

    expect(getRuntimeConfig().apiKey).toBe('firebase-key');
    expect(isAiConfigured()).toBe(true);
    expect(isCloudSyncEnabled()).toBe(true);
    expect(isFirebaseConfigured()).toBe(true);
  });
});
