export interface RuntimeConfig {
  environment: 'development' | 'test' | 'staging' | 'production';
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  firebaseProjectId?: string;
}

export function resolveFirestoreDatabaseId(
  env: NodeJS.ProcessEnv = process.env,
  component = 'server process',
): string | undefined {
  const databaseId = env.FIRESTORE_DATABASE_ID?.trim();
  if (databaseId) return databaseId;
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `FIRESTORE_DATABASE_ID is required in production so the ${component} cannot silently use the default Firestore database.`,
    );
  }
  return undefined;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const environment = (env.NODE_ENV ?? 'development') as RuntimeConfig['environment'];
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  return {
    environment,
    port,
    logLevel: (env.LOG_LEVEL ?? 'info') as RuntimeConfig['logLevel'],
    ...(env.FIREBASE_PROJECT_ID ? { firebaseProjectId: env.FIREBASE_PROJECT_ID } : {}),
  };
}
