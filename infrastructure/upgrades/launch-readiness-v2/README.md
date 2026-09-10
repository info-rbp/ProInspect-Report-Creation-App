# ProInspect Launch Readiness Installation Package v2

This package turns the launch-readiness scorecard into an executable, fail-closed VS Code workflow. It coordinates source completion, non-production infrastructure installation, migration, deployment, recovery and independent acceptance evidence. It deliberately does **not** make a Production traffic switch or retire legacy systems.

## Outcomes

The controller has three separate outcomes:

1. `INSTALLED_NOT_LAUNCH_READY`: installation/deployment actions completed, but acceptance is not implied.
2. `NOT_LAUNCH_READY`: one or more required gates are missing, failed or stale.
3. `READY_FOR_RELEASE_REVIEW`: the exact candidate has fresh passing Development and Staging evidence. This still does not authorise Production.

The acceptance contract contains 19 dependency-ordered gates and 159 named assertions covering architecture/source, build/security, recovery, Appwrite, identity/MFA, transactions, all seven portals, reports, building/Strata, resident/contractor, offers, offline devices, structured/file migration, Shopify/Calendar, workers, Cloudflare, monitoring/support and Staging cutover/rollback.

## Safety model

The package rejects `--env production` and specifically prohibits the known Production-like Appwrite project `6a911f1e0031e90015b2`, Google project `business-plan-applicatio-17047`, and root Cloudflare Worker `proinspect`. Development is pinned to `proinspect-development` / `ProInspect Development` in Sydney. Staging must use separate Appwrite, Google, Cloudflare and public-origin identifiers.

Remote writes require an exact confirmation string, a clean repository, an approved tracked policy document, explicit non-production target IDs, an exclusive lock and a current tested backup. Appwrite mutation uses short-lived console-created keys that are deleted in `finally`; application runtime keys are per-service, expiring, scope-bounded and stored as immutable Google Secret Manager versions. Secrets are process inputs, never command arguments or committed values.

Schema changes are additive only. Unexpected live columns/indexes/buckets or incompatible in-place changes block execution instead of being deleted. Migration never overwrites conflicting rows/files and rollback removes only objects recorded as created by that exact migration run. Source data is never deleted.

The backup action encrypts database rows and files with AES-256-GCM using `LAUNCH_BACKUP_KEY`, performs a second consistency read, restores into isolated temporary Appwrite database/bucket IDs, verifies hashes/permissions, then removes only those probe resources. Backups live outside the repository.

## What the installer can do

- run CI-equivalent source validation in a detached Git worktree;
- verify Appwrite/Google/Cloudflare/Shopify target identity;
- back up and restore-probe Appwrite database/files;
- create missing additive Appwrite schema resources from source-controlled definitions;
- import a reviewed normalized migration bundle with checksums, parent references and resumable journals;
- provision bounded per-service Appwrite runtime credentials into Google Secret Manager;
- run Terraform plans with foreign-project/destructive-action guards;
- build immutable Google container images from the exact Git commit and deploy Cloud Run revisions;
- build and deploy the Cloudflare web/edge candidate with security headers and exact release identity;
- replay a synthetic Shopify webhook against the non-production edge without changing Shopify configuration;
- invoke local Codex workpacks to implement remaining source gaps and acceptance adapters;
- reject mocked/skipped/stale acceptance evidence and generate the launch scorecard.

The package cannot truthfully pre-build business behavior that remains incomplete in the application. `launch:complete --execute` is the controlled source-engineering mechanism for those gaps. Its output remains uncommitted and must pass normal review/tests before live acceptance. Missing acceptance adapters always block the launch gate rather than being treated as success.

## Prerequisites

Use VS Code on macOS/Linux or WSL. The live path is pinned to Node `22.23.2`, npm `10.9.2`, Appwrite CLI `27.2.1` and Wrangler `4.120.0`. Terraform, `gcloud`, Appwrite CLI and optionally `codex` must already be authenticated in the VS Code terminal. Required cloud API tokens/credentials are supplied by environment variables or provider login, not saved in the repository.

The repository itself requires `node-appwrite`; the Appwrite server package already depends on it. Do not run the live installer until `npm ci` has completed successfully.

## First activation

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run launch:audit
npm run launch:plan
npm run launch:init
code "$(git rev-parse --git-path proinspect-launch-v2/config.json)"
```

Fill the private config with the real non-production identifiers. Copy `policy.example.json` to a tracked operations document, complete all decisions and approvals, commit it, then set `policyDocument` to that repository-relative path.

For every Google service, populate `runtimeBindings` with reviewed non-secret environment values and immutable Secret Manager references. Configure per-service `runtimeCredentialPolicies` with the minimum Appwrite scopes required by the code. Configure private absolute Terraform tfvars/backend JSON paths, backup directory, and a normalized migration-bundle directory/hash. Configure Shopify replay only with a synthetic Development fixture.

Run provider checks before mutation:

```bash
npm run launch:doctor
npm run launch:doctor -- --live
```

## Source completion

Generate the workpacks:

```bash
npm run launch:complete -- --stage all
```

To let an authenticated local Codex CLI implement one workstream:

```bash
npm run launch:complete -- --stage transactions --execute --confirm SOURCE_EDITS_ONLY
```

This is source engineering only. It does not deploy, migrate or grant acceptance. Review the diff, run tests, and commit approved changes. Register a committed acceptance adapter under `infrastructure/launch-adapters/<gate>.mjs` only after it genuinely exercises the named assertions.

## Installation sequence

Always execute individual stages first. The no-`--apply` form is a plan.

```bash
npm run launch:install -- --stage source
npm run launch:install -- --stage source --apply --confirm INSTALL:development:proinspect-development

export LAUNCH_BACKUP_KEY='<64 hex chars from your secret manager>'
npm run launch:install -- --stage backup --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage schema --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage data --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage files --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage terraform --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage credentials --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage google --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage cloudflare --apply --confirm INSTALL:development:proinspect-development
npm run launch:install -- --stage shopify --apply --confirm INSTALL:development:proinspect-development
unset LAUNCH_BACKUP_KEY
```

The all-stage command is available only after the configuration is complete and should be used once the individual stages have been rehearsed:

```bash
npm run launch:install -- --stage all --apply --confirm INSTALL:development:proinspect-development
```

A credential stage changes private launch configuration because it records approved key IDs and immutable Secret Manager version references. The controller immediately requires a new backup against the new configuration hash. It never writes secrets to that file.

## Acceptance

Local gates:

```bash
npm run launch:verify -- --stage source
npm run launch:verify -- --stage build
```

Live gates require `--live --apply` and exact target confirmation:

```bash
npm run launch:verify -- --stage recovery --live --apply --confirm ACCEPT:development:proinspect-development
npm run launch:verify -- --stage appwrite --live --apply --confirm ACCEPT:development:proinspect-development
# Continue each gate only after its dependencies pass.
npm run launch:verify -- --stage all --live --apply --confirm ACCEPT:development:proinspect-development
npm run launch:status
```

`--resume` is accepted for verification only and reuses only fresh hash-verified evidence for the exact source/configuration/dependency chain. Installation writes are never blindly resumed after an interruption.

After the same commit passes Development, configure an isolated Staging environment and repeat installation plus all acceptance gates. Staging additionally requires the cutover/rollback rehearsal.

```bash
npm run launch:verify -- --env staging --stage all --live --apply --confirm ACCEPT:staging:ACTUAL_STAGING_APPWRITE_ID
npm run launch:gate -- --env staging
```

A successful gate returns `READY_FOR_RELEASE_REVIEW`, not Production authorisation.

## Migration bundle contract

`migration.bundleDirectory/manifest.json` is private and SHA-256 pinned in configuration. It must contain `schemaVersion`, `projectId`, `approvedBy`, `approvedAt`, `sourceDisposition`, `rows` and `files`. Every row includes `tableId`, deterministic `id`, source identity, data SHA-256, explicit private permissions and parent references. Every file includes bucket/id/path/name/SHA-256/private permissions. Passwords, sessions, access tokens and public grants are rejected.

The existing 49-table Strata D1 manifest is the required source-disposition basis. Actual D1/Firestore/R2/Firebase exports and approved transforms still have to be created from the real source snapshots in VS Code. The package does not invent missing source data.

## Rollback and interruption

Every action writes a private state record before the operation and records failure without automatically retrying. Inspect remote state before re-running a failed stage. Migration has an explicit own-record rollback that refuses ambiguous `PENDING` operations or edited targets. Google and Cloudflare deployment records capture previous revisions/deployments for rollback. Database restore of active application data is intentionally not automatic because a code rollback and a data rollback are not equivalent operations.

A stale same-host lock may be removed only after its PID is demonstrably dead:

```bash
npm run launch:unlock -- --confirm UNLOCK:PID
```

## Validation during package authoring

The package is subject to its own Node regression suite and GitHub workflow. That workflow runs on Node `22.23.2`, verifies package integrity and performs a clean-checkout dry run. It also creates a one-day private artifact containing the exact tracked source tree. This artifact excludes untracked launch state and environment secrets because it is produced with `git archive`.

No cloud deployment or Production mutation is performed by CI. Live Appwrite, Cloudflare, Google, Shopify, migration, physical-device and Staging acceptance remains explicit evidence collected from the authenticated VS Code environment.

## Explicit rollback commands

Rollback is never automatic. After inspecting the recorded deployment state, set the private `rollback.googleRecord` / `rollback.cloudflareRecord` paths and execute the single reviewed action using `launch:install -- --stage rollback-google` or `rollback-cloudflare` with the normal exact non-production INSTALL confirmation. Migration rollback additionally requires `migration.rollbackApproved=true` and removes only unchanged records/files created by that migration journal. Database/application rollback is a separately rehearsed operation, not implied by an edge rollback.
