import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('Storage rules foundation', () => {
  it('rejects unauthenticated writes', () => {
    const rules = readFileSync('infrastructure/firebase/storage.rules', 'utf8');
    expect(rules).toContain('request.auth != null');
  });
});
