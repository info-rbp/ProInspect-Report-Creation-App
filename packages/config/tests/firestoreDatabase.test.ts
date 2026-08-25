import { describe, expect, it } from 'vitest';
import { resolveFirestoreDatabaseId } from '../src/index.js';

describe('server Firestore database selection', () => {
  it('returns the explicitly configured named database', () => {
    expect(resolveFirestoreDatabaseId({
      NODE_ENV: 'production',
      FIRESTORE_DATABASE_ID: 'named-production-database',
    }, 'test worker')).toBe('named-production-database');
  });

  it('rejects a missing database ID in every production server process', () => {
    expect(() => resolveFirestoreDatabaseId({ NODE_ENV: 'production' }, 'PDF worker'))
      .toThrow('PDF worker cannot silently use the default Firestore database');
  });

  it('allows emulator and local development to use the default database', () => {
    expect(resolveFirestoreDatabaseId({ NODE_ENV: 'test' }, 'test worker')).toBeUndefined();
  });
});
