import { Client, Storage, TablesDB, Teams, Users } from 'node-appwrite';

export interface AppwriteServerConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
  databaseId: string;
}

export interface AppwriteServerServices {
  client: Client;
  tables: TablesDB;
  storage: Storage;
  users: Users;
  teams: Teams;
  databaseId: string;
}

export function loadAppwriteServerConfig(env: NodeJS.ProcessEnv = process.env): AppwriteServerConfig {
  const endpoint = env.APPWRITE_ENDPOINT?.trim();
  const projectId = env.APPWRITE_PROJECT_ID?.trim();
  const apiKey = env.APPWRITE_API_KEY?.trim();
  const databaseId = env.APPWRITE_DATABASE_ID?.trim() || 'proinspect_core';
  const missing = [!endpoint && 'APPWRITE_ENDPOINT', !projectId && 'APPWRITE_PROJECT_ID', !apiKey && 'APPWRITE_API_KEY'].filter(Boolean);
  if (missing.length) throw new Error(`Appwrite server configuration is incomplete: ${missing.join(', ')}.`);
  if (!endpoint!.startsWith('https://')) throw new Error('APPWRITE_ENDPOINT must use HTTPS.');
  return { endpoint: endpoint!, projectId: projectId!, apiKey: apiKey!, databaseId };
}

export function createAppwriteServerServices(config: AppwriteServerConfig): AppwriteServerServices {
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(config.apiKey);
  return {
    client,
    tables: new TablesDB(client),
    storage: new Storage(client),
    users: new Users(client),
    teams: new Teams(client),
    databaseId: config.databaseId,
  };
}
