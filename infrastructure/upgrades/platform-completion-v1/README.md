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

The update contains all source changes and verification needed for:

- Stage 2D closeout and live seven-persona acceptance
- Stage 2E Appwrite Storage and evidence authority
- Stage 3 transaction/recovery safety
- Stage 4 runtime parity and worker authority
- Stage 5 seven-persona and representative Development fixtures
- Stage 6 structured UAT readiness
- Stage 7 offline inspector field operations
- Stage 8 migration dry-run/reconciliation
- Stage 9 Shopify Development integration validation
- Stage 10 Google worker Development integration validation
- Stage 11 environment bootstrap and toolchain pinning
- Stage 12 security/recovery hardening
- Stage 13 performance/readiness polish

Production mutation is intentionally out of scope. Shopify and Google Cloud Development actions are guarded and require the authenticated local CLI/VS Code extensions to already be connected to the correct Development resources.

## Installer model

The source portion of this update is installed by merging the update branch. The installer then performs guarded environment provisioning and validation.

```bash
git fetch origin
git checkout feat/seven-portal-completion-chatgpt
git pull --ff-only
git merge --ff-only origin/upgrade/platform-completion-v1

nvm use 22.23.2
npm ci
npm run upgrade:preflight -- --development
npm run upgrade:verify
npm run upgrade:install -- --development
```

The installer refuses the wrong Appwrite project, malformed endpoint values, wrong Node/Appwrite CLI versions, a dirty working tree, or a missing update manifest.

## Live credentials

The installer never stores secrets in the repository. Live Development acceptance can use environment variables supplied in the terminal, including:

- `APPWRITE_SEED_PASSWORD`
- Shopify Development bridge variables documented by the Stage 9 verifier
- Google Cloud Development project/region variables documented by the Stage 10 verifier

If `APPWRITE_SEED_PASSWORD` is supplied and GitHub CLI is authenticated, the installer can synchronize that value to the GitHub Actions repository secret without echoing it.

## Main commands

```bash
npm run upgrade:status
npm run upgrade:preflight
npm run upgrade:verify
npm run upgrade:install -- --development
npm run upgrade:ci
```

`upgrade:verify` is source-only and safe to run repeatedly. `upgrade:install -- --development` is the explicit Development mutation command and runs Appwrite validation, push, audit, seed/live acceptance where credentials permit, followed by the full testing-readiness gate.

## Completion definition

The update is considered installed for Development only when:

1. the source verification passes all Stage 2D-13 boundaries;
2. `npm run check`, emulator, E2E and security scans pass;
3. Appwrite audit reports the expected Development project with zero persistent API keys;
4. the seven portal personas pass live acceptance;
5. Stage 9/10 Development integration checks pass when those integrations are enabled;
6. the working tree remains clean after verification.
