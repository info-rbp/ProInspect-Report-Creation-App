import type { App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { resolveFirestoreDatabaseId } from '@pcr/config';

const runtimeDatabaseId = resolveFirestoreDatabaseId(process.env, 'API');

export function firestoreDatabaseId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env === process.env ? runtimeDatabaseId : resolveFirestoreDatabaseId(env, 'API');
}

export function firestoreDb(app: App, env: NodeJS.ProcessEnv = process.env): Firestore {
  const databaseId = firestoreDatabaseId(env);
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}
