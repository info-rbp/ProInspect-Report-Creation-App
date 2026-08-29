import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDevelopmentTarget } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = assertDevelopmentTarget({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
}, process.env.APPWRITE_CONFIRM_PUSH ?? 'push-development');
const output = resolve(root, '.generated');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const source = JSON.parse(await readFile(resolve(root, 'appwrite.config.json'), 'utf8'));
source.projectId = target.projectId;
source.projectName = target.projectName;
source.endpoint = target.endpoint;
await writeFile(resolve(output, 'appwrite.config.json'), `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
for (const directory of ['databases', 'tables', 'buckets', 'teams', 'functions']) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
console.log(`Materialized Development Appwrite configuration for project ${target.projectId}.`);
