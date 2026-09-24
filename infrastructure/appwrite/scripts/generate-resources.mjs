import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tables } from '../tables/schema.mjs';
import { unifiedPlatformExtensionTables } from '../tables/unified-platform-extensions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allTables = [...tables, ...unifiedPlatformExtensionTables];
await writeFile(resolve(root, 'tables/tables.json'), `${JSON.stringify(allTables, null, 2)}\n`);
console.log(`Generated ${allTables.length} Appwrite TablesDB table definitions.`);

const workerSchema = Object.fromEntries(allTables.map((table) => [table.$id, table.columns.map(({ key, type, required }) => ({ key, type, required }))]));
await writeFile(resolve(root, '../../packages/appwrite-server/src/workerSchema.ts'), `// Generated from the canonical Appwrite schema. Run npm run appwrite:generate.\nexport const workerSchema: Record<string, Array<{key: string; type: string; required: boolean}>> = ${JSON.stringify(workerSchema)};\n`);
