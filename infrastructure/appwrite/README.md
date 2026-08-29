# ProInspect Appwrite foundation

This directory is the version-controlled Appwrite foundation for the future ProInspect operational backend. Firebase/Firestore, Firebase Storage, Cloudflare D1/R2, Shopify, and the existing Google Cloud workers remain authoritative until a separately approved domain cutover.

## Safety boundary

The checked-in `appwrite.config.json` intentionally contains the non-deployable project ID `DEVELOPMENT_PROJECT_ID_REQUIRED`. Scripts refuse to push, seed, verify, or clear unless the live project name clearly contains `Development` and the caller supplies the matching confirmation value. Staging and Production are never inferred from Development configuration.

The foundation was deployed and verified on 2026-08-29 in the isolated Sydney project `proinspect-development`, whose live name is `ProInspect Development`. The checked-in placeholder remains intentional so a clone cannot infer a writable target.

## Toolchain

- Node `22.x`
- npm `10.9.2`
- Appwrite CLI `27.2.1`
- Appwrite Web SDK `26.2.0`
- Appwrite Node SDK `28.0.0`

Install and authenticate without committing credentials:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm install --global appwrite-cli@27.2.1
appwrite login
```

Copy `.env.example` to an ignored local environment file or export the variables from a secret manager. `APPWRITE_API_KEY` is server-only and must never use a `VITE_` prefix.

## Layout

- `appwrite.config.json` — Appwrite CLI root config and restrictive Auth defaults.
- `tables/schema.mjs` — maintainable source of truth for TablesDB columns and query-driven indexes.
- `tables/tables.json` — generated Appwrite CLI table definitions.
- `databases`, `buckets`, `teams`, `functions` — modular CLI resources.
- `platforms` — explicit Development browser hostnames reconciled through the guarded push script.
- `scripts` — generation, validation, Development deployment, verification, and seed controls.
- `migrations` — deterministic, dry-run-first migration framework.
- `seeds` — fixed synthetic Development data only.

## Local validation

```bash
npm run appwrite:generate
npm run appwrite:validate
npm run test:unit
npm run typecheck
```

`appwrite:validate` checks generated drift, table/index integrity, required foundation resources, deny-by-default table permissions, row security, bucket file security, encryption, and antivirus.

## Development promotion

First create or select a separate project whose live name contains `Development`. Create a least-privilege server key covering only the resources needed by schema verification and seed operations.

```bash
export APPWRITE_ENDPOINT=https://syd.cloud.appwrite.io/v1
export APPWRITE_PROJECT_ID=...
export APPWRITE_PROJECT_NAME='ProInspect Development'
export APPWRITE_ORGANIZATION_ID=...
export APPWRITE_CONFIRM_PUSH=push-development
npm run appwrite:prepare:development
npm run appwrite:push:development
```

The push script re-fetches the live project through the organization API, requires an exact ID/name match, requires active status, and requires CLI `27.2.1`. It supplies explicit non-interactive selection only after those guards pass and stops on the first rejected resource.

Then verify and seed:

```bash
export APPWRITE_API_KEY=... # server-only secret
export APPWRITE_CONFIRM_VERIFY=verify-development
npm run appwrite:verify

export APPWRITE_CONFIRM_VERIFY=verify-development
npm run appwrite:audit:development

export APPWRITE_SEED_PASSWORD=... # temporary Development-only value
export APPWRITE_CONFIRM_SEED=seed-development
npm run appwrite:seed:development

export APPWRITE_CONFIRM_TEST=test-development
npm run appwrite:test:development
```

The live workflow test uses email/password sessions to resolve agency and site memberships, retrieve permitted sites and properties, create a transactional ServiceRequest and AuditEvent, upload and download evidence, and prove a second authenticated user is denied access. Its request, audit, evidence metadata, file, and sessions are removed after the test.

Seed cleanup is intentionally separate and only deletes fixed IDs in `seeds/development.json`:

```bash
export APPWRITE_ENVIRONMENT=development
export APPWRITE_CONFIRM_CLEAR=clear-development-seed
npm run appwrite:clear-seed:development
```

## Staging and Production

Create separate projects, keys, SMTP/auth settings, platforms, teams, and storage resources. Promotion requires schema export/review, migration rehearsal, negative permission tests, backup/rollback evidence, change approval, and an explicit environment-specific config. Never reuse the Development API key or generated `.generated` directory.
