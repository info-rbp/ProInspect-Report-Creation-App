import type { App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function firestoreDatabaseId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const databaseId = env.FIRESTORE_DATABASE_ID?.trim();
  if (databaseId) return databaseId;
  if (env.NODE_ENV === 'production') {
    throw new Error('FIRESTORE_DATABASE_ID is required in production so the API cannot silently use the default Firestore database.');
  }
  return undefined;
}

export function firestoreDb(app: App, env: NodeJS.ProcessEnv = process.env): Firestore {
  const databaseId = firestoreDatabaseId(env);
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}
