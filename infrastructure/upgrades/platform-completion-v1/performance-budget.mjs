import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

const assets = resolve(root, 'apps/web/dist/assets');
if (!existsSync(assets)) {
  console.log('INFO Stage 13 performance budget: web dist is not present; build gate will generate it.');
  process.exit(0);
}

const js = readdirSync(assets)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, size: statSync(resolve(assets, name)).size }))
  .sort((a, b) => b.size - a.size);

const maxSingle = 2_750_000;
const maxTotal = 4_500_000;
const total = js.reduce((sum, item) => sum + item.size, 0);
const oversized = js.filter((item) => item.size > maxSingle);

if (oversized.length) {
  throw new Error(`Stage 13 performance budget exceeded: ${oversized.map((item) => `${item.name}=${item.size}`).join(', ')}`);
}
if (total > maxTotal) {
  throw new Error(`Stage 13 total JS budget exceeded: ${total} > ${maxTotal}.`);
}
console.log(`PASS Stage 13 performance budget: ${js.length} JS assets, ${total} bytes total, largest ${js[0]?.size ?? 0} bytes.`);
