import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const markdownPath = resolve(root, 'docs/migrations/strata-feature-parity.md');
const registerPath = resolve(root, 'docs/migrations/strata-feature-parity.json');
const finalStatuses = new Set([
  'COMPLETE',
  'RETIRED_WITH_APPROVAL',
  'EXTERNAL_BY_DESIGN',
  'BLOCKED_OWNER_INPUT',
]);
const workingStatuses = new Set(['ENGINEERING_INCOMPLETE']);
const allowedStatuses = new Set([...finalStatuses, ...workingStatuses]);

function fail(message) {
  console.error(`Strata feature parity verification failed: ${message}`);
  process.exitCode = 1;
}

if (!existsSync(markdownPath)) fail('docs/migrations/strata-feature-parity.md is missing.');
if (!existsSync(registerPath)) fail('docs/migrations/strata-feature-parity.json is missing.');

if (!process.exitCode) {
  const markdown = readFileSync(markdownPath, 'utf8');
  const expectedCapabilities = markdown
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('| ') && !line.startsWith('| ---'))
    .map((line) => line.split('|')[1]?.trim())
    .filter((value) => value && value !== 'Capability');
  const register = JSON.parse(readFileSync(registerPath, 'utf8'));
  const entries = Array.isArray(register.entries) ? register.entries : [];
  const byCapability = new Map();

  for (const [index, entry] of entries.entries()) {
    const location = `entries[${index}]`;
    if (!entry || typeof entry !== 'object') {
      fail(`${location} must be an object.`);
      continue;
    }
    if (typeof entry.capability !== 'string' || !entry.capability.trim()) {
      fail(`${location}.capability is required.`);
      continue;
    }
    if (byCapability.has(entry.capability)) fail(`duplicate capability '${entry.capability}'.`);
    byCapability.set(entry.capability, entry);
    if (!allowedStatuses.has(entry.status)) fail(`${entry.capability} has unsupported status '${entry.status}'.`);

    if (entry.status === 'COMPLETE') {
      for (const field of ['implementationFiles', 'testFiles']) {
        if (!Array.isArray(entry[field]) || entry[field].length === 0) {
          fail(`${entry.capability} is COMPLETE but has no ${field}.`);
          continue;
        }
        for (const path of entry[field]) {
          if (typeof path !== 'string' || !existsSync(resolve(root, path))) {
            fail(`${entry.capability} references missing ${field} path '${path}'.`);
          }
        }
      }
      if (Array.isArray(entry.remainingEngineering) && entry.remainingEngineering.length > 0) {
        fail(`${entry.capability} is COMPLETE but still lists remaining engineering.`);
      }
    }
    if (entry.status === 'ENGINEERING_INCOMPLETE'
      && (!Array.isArray(entry.remainingEngineering) || entry.remainingEngineering.length === 0)) {
      fail(`${entry.capability} is ENGINEERING_INCOMPLETE but has no remainingEngineering.`);
    }
    if (entry.status === 'BLOCKED_OWNER_INPUT') {
      if (!Array.isArray(entry.ownerActions) || entry.ownerActions.length === 0) {
        fail(`${entry.capability} is BLOCKED_OWNER_INPUT but has no ownerActions.`);
      }
      if (Array.isArray(entry.remainingEngineering) && entry.remainingEngineering.length > 0) {
        fail(`${entry.capability} hides unfinished engineering behind BLOCKED_OWNER_INPUT.`);
      }
    }
    if (entry.status === 'RETIRED_WITH_APPROVAL'
      && (typeof entry.approvalReference !== 'string' || !entry.approvalReference.trim())) {
      fail(`${entry.capability} is RETIRED_WITH_APPROVAL but has no approvalReference.`);
    }
    if (entry.status === 'EXTERNAL_BY_DESIGN'
      && (typeof entry.ownershipBoundary !== 'string' || !entry.ownershipBoundary.trim())) {
      fail(`${entry.capability} is EXTERNAL_BY_DESIGN but has no ownershipBoundary.`);
    }
  }

  const missing = expectedCapabilities.filter((capability) => !byCapability.has(capability));
  const extra = [...byCapability.keys()].filter((capability) => !expectedCapabilities.includes(capability));
  if (missing.length) fail(`machine-readable register is missing: ${missing.join(', ')}.`);
  if (extra.length) fail(`machine-readable register has undocumented entries: ${extra.join(', ')}.`);

  if (!process.exitCode) {
    const counts = Object.fromEntries([...allowedStatuses].map((status) => [
      status,
      entries.filter((entry) => entry.status === status).length,
    ]));
    console.log(`Strata feature parity register verified: ${entries.length} capabilities (${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ')}).`);
  }
}
