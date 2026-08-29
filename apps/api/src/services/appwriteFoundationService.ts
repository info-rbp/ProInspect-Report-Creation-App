import {
  AppwriteFoundationService,
  AppwriteTablesGateway,
  createAppwriteServerServices,
  loadAppwriteServerConfig,
} from '@pcr/appwrite-server';

/**
 * Builds the future Appwrite repository boundary without changing the current
 * Firestore authority. No production route should call this until a domain
 * cutover explicitly selects Appwrite after migration and reconciliation.
 */
export function createOptionalAppwriteFoundation(env: NodeJS.ProcessEnv = process.env): AppwriteFoundationService | undefined {
  if (env.APPWRITE_BACKEND_MODE !== 'foundation') return undefined;
  const services = createAppwriteServerServices(loadAppwriteServerConfig(env));
  return new AppwriteFoundationService(new AppwriteTablesGateway(services.tables, services.databaseId));
}
