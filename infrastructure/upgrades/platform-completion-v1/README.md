# ProInspect Platform Completion Update v1

This package is the controlled software update for the ProInspect Development platform from the completed Stage 2D baseline through Stage 13 testing readiness.

## Baseline and target

- Source branch: `feat/seven-portal-completion-chatgpt`
- Baseline commit: `030d2650870f09556e72b7aebb58a4bec2a7a75f`
- Update-media branch: `upgrade/platform-completion-v1`
- Node: `22.23.2`
- npm: `10.9.2`
- Appwrite CLI: `27.2.1`
- Development Appwrite project: `proinspect-development`
- Target Appwrite schema: `120` unique tables
- Shopify Development store: `proinspect-2.myshopify.com`

The legacy standalone Appwrite project `6a911f1e0031e90015b2` and the documented Production Google Cloud project `business-plan-applicatio-17047` are explicitly prohibited targets.

## GitHub Actions is not required

GitHub Actions is an optional, manually dispatched future CI surface for this update. It does not trigger on branch pushes and is not a completion dependency. The authoritative validation paths are local and are designed for the VS Code terminal:

- `npm run upgrade:audit` performs a non-mutating installer-media audit, including duplicate Appwrite table-ID detection.
- `npm run upgrade:local` creates a temporary detached Git worktree, installs dependencies there, applies the complete update and runs all local readiness gates without mutating Appwrite Development.
- `npm run upgrade:install -- --development` repeats the guarded source installation and local gates before allowing the Development Appwrite push.

## Stage coverage

The manifest records how each stage is completed rather than pretending every stage is a fresh rewrite:

- Stage 2D: baseline verification of canonical external-grant authority.
- Stage 2E: source migration to Appwrite Storage/evidence authority with an explicit Firebase rollback/emulator fallback.
- Stage 3: verification of existing Appwrite transaction commit/rollback and recovery coverage.
- Stage 4: source migration for dedicated `client_approvals` parity and canonical notification-worker grant authority.
- Stage 5: verification of seven Development personas, portal entitlements and representative fixtures.
- Stage 6: local seven-portal live acceptance plus consolidated UAT readiness gates.
- Stage 7: in-place migration of the existing `offline_sync_receipts` table to operation-level idempotent replay receipts, retaining optional legacy receipt fields plus stable replay operation IDs, fail-closed replay scope, server idempotency and permanent offline queue/replay regression coverage.
- Stage 8: local verification of the deterministic migration dry-run/reconciliation framework. Representative live migration remains a controlled UAT activity rather than an automatic installer action.
- Stage 9: Shopify integration contract verification plus exact Development-store target guard.
- Stage 10: canonical worker/outbox contract verification plus explicit Google Cloud Development-project guard.
- Stage 11: environment/toolchain bootstrap and target safety.
- Stage 12: security, dependency, isolation and recovery gates.
- Stage 13: blocking front-end performance budget.

Production mutation is intentionally out of scope.

## First: audit the update media

From a clean checkout of the update branch:

```bash
git fetch origin
git checkout upgrade/platform-completion-v1
git pull --ff-only

nvm use 22.23.2
npm install -g npm@10.9.2 appwrite-cli@27.2.1
export PATH="$(npm prefix -g)/bin:$PATH"
hash -r

node --version
npm --version
appwrite --version

npm ci
npm run upgrade:audit
npm run upgrade:local
```

`upgrade:local` uses a temporary detached worktree. A successful or failed validation does not leave the update branch modified and cannot push Appwrite resources. It also runs a bounded-diff audit so the installed update may change only its declared application files.

## Installation model

The upgrade branch is the update media. Merge it into the completed Stage 2D feature branch, then run the guarded Development installer. Do not run `upgrade:apply` separately before `upgrade:install`; the installer applies the source update itself.

```bash
git fetch origin
git checkout feat/seven-portal-completion-chatgpt
git pull --ff-only
git merge --ff-only origin/upgrade/platform-completion-v1

nvm use 22.23.2
npm install -g npm@10.9.2 appwrite-cli@27.2.1
export PATH="$(npm prefix -g)/bin:$PATH"
hash -r
npm ci

export APPWRITE_ENDPOINT="https://syd.cloud.appwrite.io/v1"
export APPWRITE_PROJECT_ID="proinspect-development"
export APPWRITE_PROJECT_NAME="ProInspect Development"
export APPWRITE_CONFIRM_PUSH="push-development"
export APPWRITE_CONFIRM_VERIFY="verify-development"

unset APPWRITE_API_KEY
read -s "APPWRITE_SEED_PASSWORD?Development seed password: "
echo
export APPWRITE_SEED_PASSWORD

npm run upgrade:audit
npm run upgrade:preflight -- --development
npm run upgrade:install -- --development
```

The Development installer requires `APPWRITE_SEED_PASSWORD` because seven-portal live acceptance is mandatory. It refuses `APPWRITE_API_KEY`; re-seeding with a deliberately created temporary key is a separate administrative operation and is not part of this installation package.

## Strict integrated-UAT installation

Strict integrated UAT is an **alternative first installation mode**, not a command to run after the normal installer has already modified the working tree. Before the first `upgrade:install`, declare the exact Shopify store and explicitly name the authenticated Google Cloud Development project:

```bash
export SHOPIFY_STORE_DOMAIN="proinspect-2.myshopify.com"
export GOOGLE_CLOUD_PROJECT="YOUR_GOOGLE_CLOUD_DEVELOPMENT_PROJECT_ID"

gcloud config get-value project

npm run upgrade:install -- --development --require-integrations
```

The installer checks that `gcloud config get-value project` exactly matches `GOOGLE_CLOUD_PROJECT`, rejects the documented Production Google Cloud project and requires the exact Shopify Development store. The repository does not define a trustworthy Shopify CLI connectivity command, so the package does not invent one; authenticated Shopify Developer/VS Code bridge testing remains part of integrated UAT after the target guard succeeds.

## Commands

```bash
npm run upgrade:status
npm run upgrade:audit
npm run upgrade:local
npm run upgrade:preflight -- --development
npm run upgrade:install -- --development
npm run upgrade:verify
```

- `upgrade:status` shows installer state stored under `.git/`.
- `upgrade:audit` verifies manifest coverage, authoritative patchers, payloads, target schema, unique source table IDs, safety declarations, bounded-diff support and root command exposure. It does not alter source or remote systems.
- `upgrade:local` performs an isolated clean-checkout installation and all local test gates in a temporary Git worktree. It does not mutate Development.
- `upgrade:preflight -- --development` proves the repository baseline, exact toolchain and safe Appwrite Development target.
- `upgrade:install -- --development` applies the source update, reruns the package/schema audit, runs all local gates and the bounded-diff audit, then and only then pushes Appwrite Development resources, audits the control plane and performs mandatory seven-portal live acceptance.
- `upgrade:verify` verifies an already-applied source update without pushing Development resources.
- `upgrade:ci` remains available for a manually dispatched future CI runner, but it is not required for package completion.

## Safety and execution order

The installer refuses:

- the legacy Appwrite project `6a911f1e0031e90015b2`;
- any `APPWRITE_API_KEY` during normal installation;
- a missing seven-portal seed password;
- malformed/Markdown endpoint values;
- Node/npm/Appwrite CLI version drift;
- an unexpected repository or missing Stage 2D baseline;
- a dirty working tree before Development installation;
- duplicate canonical Appwrite table IDs;
- source changes outside the declared update surface;
- the documented Production Google Cloud project;
- integrated-UAT mode when Shopify or Google Cloud Development targets cannot be positively verified.

Before `appwrite:push:development` can run, the installed source must pass formatting, duplicate table-ID auditing, linting, TypeScript, unit/rules tests, Appwrite generation/validation, production builds, artifact verification, Firebase emulator tests, Playwright E2E, secret scanning, high-severity production dependency policy, Stage 2D-13 source verification, the Stage 13 performance budget and the bounded source-diff audit.

## Completion definition

Installer-media completion requires `npm run upgrade:audit` to pass.

Local executable completion requires `npm run upgrade:local` to pass in the isolated worktree.

Core Development UAT readiness additionally requires:

1. the guarded Appwrite Development push succeeds with the 120-unique-table target;
2. the Development control-plane audit succeeds with zero persistent API keys;
3. mandatory seven-portal live acceptance succeeds using `APPWRITE_SEED_PASSWORD`;
4. the post-acceptance Development control-plane audit remains clean.

Full integrated UAT additionally requires exact Shopify Development and explicit Google Cloud Development target verification with `--require-integrations`, followed by authenticated bridge testing in the configured Development tooling.

After a successful Development install, the intentional source changes remain in the working tree for review and explicit commit. Generated TypeScript build metadata and Playwright test-result artifacts are automatically cleaned.
