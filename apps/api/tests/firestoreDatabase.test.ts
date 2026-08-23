import { describe, expect, it } from 'vitest';
import { firestoreDatabaseId } from '../src/firestoreDatabase.js';

describe('Firestore database configuration', () => {
  it('returns the configured named database', () => {
    expect(firestoreDatabaseId({ FIRESTORE_DATABASE_ID: 'proinspect-db', NODE_ENV: 'production' } as NodeJS.ProcessEnv))
      .toBe('proinspect-db');
  });

  it('trims the configured database ID', () => {
    expect(firestoreDatabaseId({ FIRESTORE_DATABASE_ID: '  proinspect-db  ', NODE_ENV: 'production' } as NodeJS.ProcessEnv))
      .toBe('proinspect-db');
  });

  it('refuses to silently use the default database in production', () => {
    expect(() => firestoreDatabaseId({ NODE_ENV: 'production' } as NodeJS.ProcessEnv))
      .toThrow('FIRESTORE_DATABASE_ID is required in production');
  });

  it('allows the default database in non-production environments', () => {
    expect(firestoreDatabaseId({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
