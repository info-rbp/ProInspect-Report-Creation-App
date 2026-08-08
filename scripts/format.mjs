import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const mode = process.argv.includes('--write') ? 'write' : 'check';
const roots = [
  'apps/api',
  'apps/ai-worker',
  'apps/pdf-worker',
  'packages',
  'scripts',
  'tests',
  'e2e',
  'infrastructure',
  '.github',
];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.rules']);
const ignored = new Set(['node_modules', 'dist', '.firebase-emulator-data']);
const ignoredPaths = new Set(['packages/domain/src/platform.ts']);
const changed = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (ignoredPaths.has(path)) continue;
    if (entry.isDirectory()) await walk(path);
    else if (extensions.has(extname(path)) || path.endsWith('.rules')) {
      const source = await readFile(path, 'utf8');
      const normalized = source
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t]+$/u, ''))
        .join('\n')
        .replace(/\n*$/u, '\n');
      if (source !== normalized) {
        changed.push(relative('.', path));
        if (mode === 'write') await writeFile(path, normalized);
      }
    }
  }
}

for (const root of roots) await walk(root);
if (changed.length && mode === 'check') {
  console.error(`Formatting required:\n${changed.join('\n')}`);
  process.exit(1);
}
if (changed.length) console.log(`${mode === 'write' ? 'Formatted' : 'Needs formatting'} ${changed.length} files.`);
