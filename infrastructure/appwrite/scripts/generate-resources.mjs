import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tables } from '../tables/schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await writeFile(resolve(root, 'tables/tables.json'), `${JSON.stringify(tables, null, 2)}\n`);
console.log(`Generated ${tables.length} Appwrite TablesDB table definitions.`);
