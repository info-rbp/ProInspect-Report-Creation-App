import { Account, Client, Realtime, Storage } from 'appwrite';

export interface AppwriteBrowserConfig {
  endpoint: string;
  projectId: string;
}

export interface AppwriteBrowserServices {
  client: Client;
  account: Account;
  storage: Storage;
  realtime: Realtime;
}

export function createAppwriteBrowserServices(config: AppwriteBrowserConfig): AppwriteBrowserServices {
  if (!config.endpoint.startsWith('https://')) throw new Error('Appwrite endpoint must use HTTPS.');
  if (!config.projectId.trim()) throw new Error('Appwrite project ID is required.');
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId);
  return { client, account: new Account(client), storage: new Storage(client), realtime: new Realtime(client) };
}
