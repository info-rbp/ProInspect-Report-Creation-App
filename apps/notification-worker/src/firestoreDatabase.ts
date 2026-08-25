import type { App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { resolveFirestoreDatabaseId } from '@pcr/config';

const runtimeDatabaseId = resolveFirestoreDatabaseId(process.env, 'notification worker');

export function firestoreDb(app: App, env: NodeJS.ProcessEnv = process.env): Firestore {
  const databaseId = env === process.env
    ? runtimeDatabaseId
    : resolveFirestoreDatabaseId(env, 'notification worker');
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}
