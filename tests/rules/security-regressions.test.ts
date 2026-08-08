import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('security regressions', () => {
  it('removes anonymous authentication from cloud storage access', () => {
    const source = readFileSync('apps/web/services/storageService.ts', 'utf8');
    expect(source).not.toContain('signInAnonymously');
  });

  it('removes public self-sign-up and the local administrator fallback', () => {
    const authSource = readFileSync('apps/web/contexts/AuthContext.tsx', 'utf8');
    const loginSource = readFileSync('apps/web/components/LoginPage.tsx', 'utf8');
    expect(authSource).not.toContain('createDevUserProfile');
    expect(authSource).not.toContain('signup');
    expect(loginSource).not.toContain('Sign up');
  });
});
