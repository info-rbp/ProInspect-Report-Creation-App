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
git merge --no-ff origin/upgrade/platform-completion-v1

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

The Development installer requires `APPWRITE_SEED_PASSWORD` because persona preparation and seven-portal live acceptance are mandatory. It refuses `APPWRITE_API_KEY`. After the first successful live audit, the preparer uses the authenticated Appwrite CLI account to create missing synthetic users, enable disabled users and reset all seven passwords. Existing IDs with unexpected emails are rejected. No API key is created or used.

On reruns, Appwrite password history may reject a reset to the already-current password. The preparer accepts that case only after the supplied password successfully authenticates as the exact expected user and the verification session is closed. A failed login, wrong identity or failed logout still fails preparation. Password-history policy remains enabled and no replacement credential is generated.

The same guarded preparation reconciles 51 source-controlled synthetic portal fixtures, including the seven entitlements, profiles/memberships, clients, properties, units, occupancies, contractor records and representative operational rows. It inspects the whole fixture plan before writing rows, rejects conflicting agency or identity scopes, applies explicit per-user read permissions and leaves already-correct rows untouched. Unrelated rows are never enumerated for mutation or deleted. This repairs Development projects that received the schema update but still contain an older seed population. The package audit executes missing-fixture, permission repair, collision, lookup-error and no-op rerun regressions and validates every fixture against the source table columns.

## Strict integrated-UAT installation

The core installer validates any declared Shopify or Google target before Appwrite mutation. The only Shopify store allowed is `proinspect-2.myshopify.com`; both Shopify domain aliases are checked. An explicit `GOOGLE_CLOUD_PROJECT` must match the local authenticated gcloud configuration and must not be the prohibited Production project.

Target declarations do not prove integration acceptance. This installer does not yet contain authenticated Shopify bridge or Google worker acceptance runners. Stages 09 and 10 therefore remain READY, including when the target guards pass; `--require-integrations` fails closed before any remote mutation until those live acceptance gates are implemented. No specialist workers are deployed by this package.

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
- `upgrade:audit` verifies manifest coverage, authoritative patchers, payloads, target schema, unique source table IDs, safety declarations, bounded-diff support and root command exposure. It also executes the persona payload against an in-memory CLI to verify all seven password resets, creation, reruns, identity protection, target guards and credential redaction, independently of source formatting. It does not alter source or remote systems.
- `upgrade:local` performs an isolated clean-checkout installation and all local test gates in a temporary Git worktree, including a byte-identical second source application. It does not mutate Development.
- `upgrade:preflight -- --development` proves the repository baseline, exact toolchain and safe Appwrite Development target.
- `upgrade:install -- --development` applies the source update, reruns the package/schema audit, runs all local gates and the bounded-diff audit, then and only then pushes Appwrite Development resources, audits the control plane, prepares the seven synthetic personas, performs mandatory seven-portal live acceptance and audits the control plane again before recording success.
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
3. all seven personas are prepared using the authenticated CLI and `APPWRITE_SEED_PASSWORD`;
4. mandatory seven-portal live acceptance succeeds using that password;
5. the post-acceptance Development control-plane audit remains clean.

Full integrated UAT additionally requires implemented and successful live Shopify bridge and Google worker acceptance gates against verified Development targets. Target environment variables alone cannot complete those stages.

After a successful Development install, the intentional source changes remain in the working tree for review and explicit commit. Generated TypeScript build metadata and Playwright test-result artifacts are automatically cleaned.
