// Legacy Firestore bootstrap removed during the Appwrite runtime-authority migration.
// Notification persistence now uses the canonical Appwrite tables directly from index.ts.
export const notificationWorkerAuthority = 'appwrite' as const;
