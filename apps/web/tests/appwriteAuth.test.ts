import { describe, expect, it } from 'vitest';
import { appwriteProfile, appwriteReturnUrl } from '../services/appwriteAuth';

describe('Appwrite browser auth adapter', () => {
  it('constructs environment-neutral callback URLs from the current origin', () => {
    expect(appwriteReturnUrl('/auth/verify-email')).toBe(`${window.location.origin}/auth/verify-email`);
    expect(appwriteReturnUrl('/auth/reset-password')).toBe(`${window.location.origin}/auth/reset-password`);
  });

  it('treats account preferences as a constrained bootstrap aid', () => {
    expect(appwriteProfile({
      $id: 'user-a', email: 'user@example.test', status: true,
      prefs: { role: 'client_user', agencyId: 'agency-a', effectiveCapabilities: ['spoofed.capability'] },
    })).toMatchObject({ uid: 'user-a', role: 'client_user', agencyId: 'agency-a', effectiveCapabilities: [] });
    expect(appwriteProfile({
      $id: 'user-b', email: 'user-b@example.test', status: false,
      prefs: { role: 'unrecognised_role' },
    })).toMatchObject({ uid: 'user-b', role: 'shopify_customer', disabled: true });
  });
});
