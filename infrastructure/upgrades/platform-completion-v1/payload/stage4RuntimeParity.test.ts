import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Stage 4 runtime parity boundary', () => {
  it('maps clientApprovals to a dedicated canonical Appwrite table', () => {
    const adapters = read('src/backend/appwriteAdapters.ts');
    expect(adapters).toContain("clientApprovals: 'client_approvals'");
    expect(adapters).toContain('collectionWriteData');
    expect(adapters).toContain('collectionReadRecord');
  });

  it('routes tenant automation grant issuance through the API provider', () => {
    const portal = read('src/backend/tenantPortalRoutes.ts');
    expect(portal).toContain('/tenant-portal-grants');
    expect(portal).toContain('automationGrant');
    expect(portal).toContain('requireExternalGrantStore');

    for (const worker of ['../notification-worker/src/index.ts', '../notification-worker/src/runtime.ts']) {
      const value = read(worker);
      expect(value).toContain('PROINSPECT_API_BASE_URL');
      expect(value).toContain('x-proinspect-automation-secret');
      expect(value).not.toContain('tenantPortalGrants');
    }
  });
});
