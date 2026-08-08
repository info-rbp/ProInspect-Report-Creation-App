import { openDB } from 'idb';

const LOCAL_PLATFORM_DB = 'proinspect-platform-db';

export type PlatformStoreName =
  | 'clients'
  | 'properties'
  | 'inspectionJobs'
  | 'reportIndexes'
  | 'users'
  | 'auditEvents';

const STORE_NAMES: PlatformStoreName[] = [
  'clients',
  'properties',
  'inspectionJobs',
  'reportIndexes',
  'users',
  'auditEvents',
];

const initPlatformDB = async () => {
  return openDB(LOCAL_PLATFORM_DB, 1, {
    upgrade(database) {
      STORE_NAMES.forEach((storeName) => {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: 'id' });
        }
      });
    },
  });
};

export const localPut = async <T extends { id: string }>(storeName: PlatformStoreName, record: T): Promise<T> => {
  const database = await initPlatformDB();
  await database.put(storeName, record);
  return record;
};

export const localGet = async <T>(storeName: PlatformStoreName, id: string): Promise<T | undefined> => {
  const database = await initPlatformDB();
  return database.get(storeName, id);
};

export const localList = async <T>(storeName: PlatformStoreName): Promise<T[]> => {
  const database = await initPlatformDB();
  return database.getAll(storeName);
};

export const localDelete = async (storeName: PlatformStoreName, id: string): Promise<void> => {
  const database = await initPlatformDB();
  await database.delete(storeName, id);
};
