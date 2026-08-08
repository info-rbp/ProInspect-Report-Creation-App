import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const requiredArtifacts = [
  'packages/config/dist/index.js',
  'packages/domain/dist/index.js',
  'packages/validation/dist/index.js',
  'packages/templates/dist/index.js',
  'packages/testing/dist/index.js',
  'packages/ui/dist/index.js',
  'apps/api/dist/app.js',
  'apps/ai-worker/dist/index.js',
  'apps/pdf-worker/dist/index.js',
];

for (const artifact of requiredArtifacts) await access(artifact);

const config = await import(pathToFileURL('packages/config/dist/index.js').href);
const domain = await import(pathToFileURL('packages/domain/dist/index.js').href);
const validation = await import(pathToFileURL('packages/validation/dist/index.js').href);
const api = await import(pathToFileURL('apps/api/dist/app.js').href);
const aiWorker = await import(pathToFileURL('apps/ai-worker/dist/index.js').href);
const pdfWorker = await import(pathToFileURL('apps/pdf-worker/dist/index.js').href);

if (config.loadRuntimeConfig({ NODE_ENV: 'test', PORT: '8080' }).environment !== 'test') throw new Error('Built config package did not load correctly.');
if (typeof domain !== 'object' || typeof validation.parseInspectionType !== 'function') throw new Error('Built shared packages could not be imported.');
if (typeof api.requestHandler !== 'function') throw new Error('Built API handler could not be imported.');
if ((await aiWorker.handleAnalysisTask('smoke')).status !== 'accepted') throw new Error('Built AI worker could not execute.');
if ((await pdfWorker.handlePdfTask('smoke')).status !== 'accepted') throw new Error('Built PDF worker could not execute.');

console.log('Built artifact verification passed.');
