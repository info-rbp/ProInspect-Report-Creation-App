# ProInspect Report Creation App

ProInspect is a multi-agency property inspection, reporting, maintenance and tenancy workflow platform. The repository contains the web application, API and background workers, shared domain/configuration packages, Firebase security/storage rules, and Google Cloud/Terraform delivery infrastructure.

## Workspace layout

- `apps/web` – React/Vite administration, inspection and portal UI.
- `apps/api` – server-authoritative HTTP API, lifecycle commands, integrations and security enforcement.
- `apps/ai-worker` – bounded AI analysis worker.
- `apps/pdf-worker` – immutable final-report PDF generation worker.
- `apps/notification-worker` – governed outbound email/SMS notification worker.
- `apps/dashboard-worker` – scheduled dashboard aggregate snapshot worker.
- `packages/*` – domain, validation, templates, report presentation, UI and test foundations.
- `infrastructure/firebase` – Firebase emulator configuration and security rules.
- `infrastructure/terraform` – Google Cloud development/staging/production landing zones and delivery pipeline.
- `infrastructure/cloud-build` – non-GitHub validation and image release fallback used when hosted Actions capacity is unavailable.

## Development

Use Node 22.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

`package-lock.json` is the reviewed dependency source of truth for CI and Cloudflare builds. Update it with Node 22/npm 10 and commit package manifest and lockfile changes together.

## Validation

Normal local validation:

```bash
npm run check
npm run test:emulator
npm run test:e2e
```

When GitHub-hosted Actions quota is unavailable, the Google Cloud validation equivalent is documented in `docs/product/github-actions-quota-release-waiver.md` and can be submitted with:

```bash
bash scripts/google-cloud-validate.sh PROJECT_ID
```

## Releases

See `docs/product/production-readiness-closeout.md` for the current release and environment acceptance gates. The guarded non-Actions image release fallback is:

```bash
bash scripts/google-cloud-release.sh PROJECT_ID RELEASE_ID
```

Terraform remains authoritative for IAM, service accounts, secrets, networking, storage, scheduler configuration and environment controls; the fallback release path only replaces Cloud Run images.
