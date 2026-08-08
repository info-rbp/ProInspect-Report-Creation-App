import { afterAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectStorageEmulator, getStorage, ref, uploadString } from 'firebase/storage';
const app = initializeApp({ projectId: 'demo-pcr', apiKey: 'demo', appId: 'demo', storageBucket: 'demo-pcr.appspot.com' }, 'storage-rules-test');
const storage = getStorage(app); connectStorageEmulator(storage, '127.0.0.1', 9199);
afterAll(() => deleteApp(app));
describe('Storage emulator rules', () => {
  it('rejects unauthenticated uploads', async () => {
    await expect(uploadString(ref(storage, 'reports/test/file.txt'), 'blocked')).rejects.toBeDefined();
  });
});
