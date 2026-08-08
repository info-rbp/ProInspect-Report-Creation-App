import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Firestore security rules', () => {
  const rules = readFileSync('infrastructure/firebase/firestore.rules', 'utf8');

  it('does not contain the email verification fallback', () => expect(rules).not.toContain('email_verified'));
  it('denies unknown documents by default', () => expect(rules).toContain('match /{document=**} { allow read, write: if false; }'));
  it('prevents ordinary clients from writing audit events', () => expect(rules).toContain('allow create, update, delete: if false;'));
});
