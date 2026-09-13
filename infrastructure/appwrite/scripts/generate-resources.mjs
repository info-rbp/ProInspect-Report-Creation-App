import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tables } from '../tables/schema.mjs';
import { unifiedPlatformExtensionTables } from '../tables/unified-platform-extensions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allTables = [...tables, ...unifiedPlatformExtensionTables];
await writeFile(resolve(root, 'tables/tables.json'), `${JSON.stringify(allTables, null, 2)}\n`);
console.log(`Generated ${allTables.length} Appwrite TablesDB table definitions.`);
