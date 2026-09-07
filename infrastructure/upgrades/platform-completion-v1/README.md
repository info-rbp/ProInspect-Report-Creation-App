# ProInspect Platform Completion Update v1

This package is the controlled software update for the ProInspect Development platform from the Stage 2D baseline through Stage 13 testing readiness.

## Baseline

- Source branch: `feat/seven-portal-completion-chatgpt`
- Baseline commit: `030d2650870f09556e72b7aebb58a4bec2a7a75f`
- Update branch: `upgrade/platform-completion-v1`
- Node: `22.23.2`
- npm: `10.9.2`
- Appwrite CLI: `27.2.1`
- Development Appwrite project: `proinspect-development`

The legacy standalone Appwrite project `6a911f1e0031e90015b2` is explicitly prohibited by the installer.

## What the update covers

The update contains source migrations and permanent closure gates for:

- Stage 2D external-grant closeout and seven-persona acceptance
- Stage 2E Appwrite Storage/evidence authority
- Stage 3 Appwrite transaction/rollback safety
- Stage 4 client-approval parity and notification-worker grant authority
- Stage 5 seven-persona and representative Development fixtures
- Stage 6 structured UAT readiness
- Stage 7 offline inspector queue/replay plus canonical sync receipts
- Stage 8 migration dry-run/reconciliation
- Stage 9 Shopify Development integration validation
- Stage 10 Google worker Development integration validation
- Stage 11 environment bootstrap/toolchain pinning
- Stage 12 security/recovery hardening
- Stage 13 performance/readiness budget

Production mutation is intentionally out of scope. Shopify and Google Cloud Development checks use the authenticated local CLI/VS Code context and fail closed when full integration readiness is explicitly required.

## Installation model

The upgrade branch is the update media. Merge it into the Stage 2D feature branch, verify the exact toolchain and Development target, then run one Development installer command. Do not run `upgrade:apply` separately before `upgrade:install`; the installer applies the source update itself.

```bash
git fetch origin
git checkout feat/seven-portal-completion-chatgpt
git pull --ff-only
git merge --ff-only origin/upgrade/platform-completion-v1

nvm use 22.23.2
npm install -g npm@10.9.2 appwrite-cli@27.2.1
npm ci

export APPWRITE_ENDPOINT="https://syd.cloud.appwrite.io/v1"
export APPWRITE_PROJECT_ID="proinspect-development"
export APPWRITE_PROJECT_NAME="ProInspect Development"
export APPWRITE_CONFIRM_PUSH="push-development"
export APPWRITE_CONFIRM_VERIFY="verify-development"

npm run upgrade:status
npm run upgrade:preflight -- --development
npm run upgrade:install -- --development
```

For the strict integrated-UAT gate, also select/authenticate the intended Google Cloud Development project in `gcloud`, set the Shopify Development store, and add `--require-integrations`:

```bash
export SHOPIFY_STORE_DOMAIN="proinspect-2.myshopify.com"
export GOOGLE_CLOUD_PROJECT="$(gcloud config get-value project)"

npm run upgrade:install -- --development --require-integrations
```

If the seven-persona live Development acceptance is required locally, set `APPWRITE_SEED_PASSWORD` in the terminal without committing it. A temporary `APPWRITE_API_KEY` is only needed when you deliberately want to re-seed Development; the installer never creates an API key itself.

## Commands

```bash
npm run upgrade:status
npm run upgrade:preflight -- --development
npm run upgrade:install -- --development
npm run upgrade:verify
npm run upgrade:ci
```

- `upgrade:status` shows installer state stored under `.git/`.
- `upgrade:preflight` proves the repository baseline, exact Node/npm/Appwrite CLI versions and safe Development target.
- `upgrade:install -- --development` applies the source migration, regenerates and pushes Appwrite Development resources, audits the control plane and runs all local testing-readiness gates.
- `upgrade:verify` verifies an already-applied source update without mutating Development.
- `upgrade:ci` is the clean-room installation path used by GitHub Actions.

## Safety

The installer refuses:

- the legacy Appwrite project `6a911f1e0031e90015b2`;
- malformed/Markdown endpoint values;
- Node/npm/Appwrite CLI version drift;
- an unexpected repository/baseline;
- a dirty working tree before Development installation;
- full integrated-UAT mode when Shopify or Google Cloud Development targets cannot be positively verified.

The installer does not create persistent Appwrite API keys and never mutates Production resources.

## Completion definition

Core Development UAT readiness requires:

1. all Stage 2D-13 source/boundary checks pass;
2. Appwrite source validates with the upgraded schema;
3. the Development push and control-plane audit succeed with zero persistent API keys;
4. `npm run check`, rules, emulator, E2E and secret scanning pass;
5. evidence, grant, approval, transaction, offline and worker boundaries are canonical;
6. the Stage 13 performance budget passes.

Full integrated UAT additionally requires positive Shopify Development and Google Cloud Development target verification and the seven-persona live acceptance when that gate is enabled.

After a successful install, the intentional source changes remain in the working tree for review and commit; generated TypeScript build metadata and test-result artifacts are automatically cleaned.
