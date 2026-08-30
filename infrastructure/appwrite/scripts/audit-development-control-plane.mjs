import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformDrift, validatePlatformDefinitions } from '../platforms/platforms.mjs';
import { tables as foundationTables } from '../tables/schema.mjs';
import { unifiedPlatformExtensionTables } from '../tables/unified-platform-extensions.mjs';
import { assertDevelopmentTarget } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.APPWRITE_CLI_BIN || 'appwrite';
const target = assertDevelopmentTarget({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
}, process.env.APPWRITE_CONFIRM_VERIFY);

function run(args, cwd = root) {
  const result = spawnSync(cli, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Appwrite CLI failed: ${args.join(' ')}`);
  return result.stdout;
}

function json(args, cwd) {
  return JSON.parse(run(['--json', ...args], cwd));
}

const versionOutput = run(['--version']).trim();
const version = versionOutput.match(/\d+\.\d+\.\d+/u)?.[0];
if (version !== '27.2.1') throw new Error(`Appwrite CLI 27.2.1 is required; found ${versionOutput}.`);

const materialize = spawnSync(process.execPath, [resolve(root, 'scripts/materialize-development-config.mjs')], {
  cwd: root,
  env: process.env,
  encoding: 'utf8',
});
if (materialize.status !== 0) throw new Error(materialize.stderr || materialize.stdout);
const generated = resolve(root, '.generated');

const account = json(['account', 'get'], generated);
const project = json(['project', 'get', '--project-id', target.projectId], generated);
if (project.$id !== target.projectId || project.name !== target.projectName || project.status !== 'active' || project.region !== 'syd') {
  throw new Error('The live control-plane project is not the confirmed active Sydney Development target.');
}

const [platformList, keyList, policyList, oauthList, databaseList, tableList, bucketList, teamList, functionList, webhookList, providerList, topicList, userList] = await Promise.all([
  Promise.resolve(json(['project', 'list-platforms', '--project-id', target.projectId, '--limit', '100'], generated)),
  Promise.resolve(json(['project', 'list-keys', '--limit', '100'], generated)),
  Promise.resolve(json(['project', 'list-policies', '--limit', '100'], generated)),
  Promise.resolve(json(['project', 'list-o-auth-2-providers', '--limit', '100'], generated)),
  Promise.resolve(json(['tablesdb', 'list', '--limit', '100'], generated)),
  Promise.resolve(json(['tablesdb', 'list-tables', '--database-id', 'proinspect_core', '--limit', '500'], generated)),
  Promise.resolve(json(['storage', 'list-buckets', '--limit', '100'], generated)),
  Promise.resolve(json(['teams', 'list', '--limit', '100'], generated)),
  Promise.resolve(json(['functions', 'list', '--limit', '100'], generated)),
  Promise.resolve(json(['webhooks', 'list', '--limit', '100'], generated)),
  Promise.resolve(json(['messaging', 'list-providers', '--limit', '100'], generated)),
  Promise.resolve(json(['messaging', 'list-topics', '--limit', '100'], generated)),
  Promise.resolve(json(['users', 'list', '--limit', '100'], generated)),
]);

const expectedPlatforms = JSON.parse(readFileSync(resolve(root, 'platforms/platforms.json'), 'utf8'));
const expectedFunctions = JSON.parse(readFileSync(resolve(root, 'functions/functions.json'), 'utf8'));
const expectedTables = [...foundationTables, ...unifiedPlatformExtensionTables];
const platformErrors = validatePlatformDefinitions(expectedPlatforms);
const drift = platformDrift(expectedPlatforms, platformList.platforms ?? []);
const errors = [...platformErrors];
if (drift.missing.length) errors.push(`Missing platforms: ${drift.missing.map((item) => item.$id).join(', ')}.`);
if (drift.extra.length) errors.push(`Untracked remote platforms: ${drift.extra.map((item) => item.$id).join(', ')}.`);
if (drift.incompatible.length) errors.push(`Incompatible platforms: ${drift.incompatible.map((item) => item.expected.$id).join(', ')}.`);
if (keyList.total !== 0) errors.push(`${keyList.total} persistent or temporary API keys remain.`);
if (functionList.total !== expectedFunctions.length) errors.push(`Remote Function count ${functionList.total} does not match source-controlled count ${expectedFunctions.length}.`);
if (webhookList.total !== 0) errors.push(`${webhookList.total} untracked Appwrite webhooks exist.`);
if (tableList.total !== expectedTables.length) errors.push(`Remote table count ${tableList.total} does not match source-controlled count ${expectedTables.length}.`);

const authMethods = Object.fromEntries((project.authMethods ?? []).map((item) => [item.$id, item.enabled]));
const summary = {
  target: { id: project.$id, name: project.name, region: project.region, status: project.status, organizationId: project.teamId },
  account: { id: account.$id, name: account.name, status: account.status },
  auth: {
    methods: authMethods,
    enabledOAuthProviders: (oauthList.providers ?? []).filter((item) => item.enabled).map((item) => item.$id),
    smtpEnabled: project.smtpEnabled,
    mfaFactors: (policyList.policies ?? []).find((item) => item.$id === 'mfa-factors') ?? null,
    verifiedUsers: (userList.users ?? []).filter((item) => item.emailVerification).length,
    mfaUsers: (userList.users ?? []).filter((item) => item.mfa).length,
  },
  counts: {
    databases: databaseList.total,
    tables: tableList.total,
    buckets: bucketList.total,
    teams: teamList.total,
    functions: functionList.total,
    platforms: platformList.total,
    apiKeys: keyList.total,
    webhooks: webhookList.total,
    messagingProviders: providerList.total,
    messagingTopics: topicList.total,
    users: userList.total,
  },
  platforms: (platformList.platforms ?? []).map((item) => ({ id: item.$id, name: item.name, type: item.type, hostname: item.hostname })),
  functions: (functionList.functions ?? []).map((item) => ({ id: item.$id, name: item.name, enabled: item.enabled, runtime: item.runtime, deploymentId: item.deploymentId, events: item.events, schedule: item.schedule, timeout: item.timeout })),
  apiKeys: (keyList.keys ?? []).map((item) => ({ id: item.$id, name: item.name, scopes: item.scopes, expire: item.expire })),
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length) throw new Error(`Development control-plane audit failed:\n${errors.map((item) => `- ${item}`).join('\n')}`);
