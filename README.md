# ProInspect Platform

ProInspect is a multi-agency property-services platform connecting service requests, properties, inspections, reports, maintenance, Building Management, Strata oversight, residents, clients, contractors, evidence, communications and audit.

This monorepo is the canonical application repository. The standalone Strata application is a migration source only and will be archived after code parity, D1/R2 reconciliation and cutover are proven.

## Portal ecosystem

One authenticated application provides seven capability-and-scope controlled workspaces:

- `/admin` – ProInspect administration and operations.
- `/inspector` – assigned field inspections, evidence, reports and offline sync.
- `/building` – daily Building Management operations.
- `/strata` – scheme oversight, decisions, approvals and reporting.
- `/resident` – owner/resident/tenant self-service.
- `/client` – client portfolio, services, reports and approvals.
- `/contractor` – assigned work, attendance, access, evidence and compliance.

Tokenised guest flows remain available for report access, approvals, quotes, signatures, tenant instructions and external work actions.

## Architecture and ownership

- **Appwrite** – target identity, operational TablesDB data, Storage, coarse Teams, row/file permissions and audit persistence.
- **ProInspect API** – business validation, capability enforcement, lifecycle transitions, high-value writes, transactions and audit creation.
- **Shopify** – catalogue, pricing, checkout, payments, refunds and financial order state.
- **Google Cloud workers** – AI, PDF, document, notification, dashboard and integration processing, progressively repointed to Appwrite-backed contracts.
- **Cloudflare** – web/edge delivery and same-origin `/api` proxy.
- **Firebase/Firestore, Firebase Storage, D1 and R2** – migration sources until their bounded domains are explicitly cut over.

Permanent bidirectional synchronisation between old and new authorities is prohibited.

## Workspace layout

- `apps/web` – React/Vite portal and operations UI.
- `apps/api` – server-authoritative HTTP API, lifecycle commands, integrations and security enforcement.
- `apps/ai-worker` – bounded AI analysis worker.
- `apps/pdf-worker` – immutable final-report PDF generation worker.
- `apps/notification-worker` – governed outbound email/SMS notification worker.
- `apps/dashboard-worker` – scheduled dashboard aggregate snapshot worker.
- `apps/document-worker` – document/template transformation worker.
- `apps/integration-worker` – connector and integration execution worker.
- `packages/domain` – shared canonical domain, roles, portal definitions and workflow policies.
- `packages/appwrite-client` / `packages/appwrite-server` – browser/server Appwrite boundaries.
- `packages/validation`, `packages/ui`, `packages/templates`, `packages/report-presentation` – shared application foundations.
- `infrastructure/appwrite` – guarded Appwrite schema, migration, seed, audit and verification tooling.
- `infrastructure/firebase` – legacy/emulator configuration and migration-source security rules.
- `infrastructure/terraform` – Google Cloud development/staging/production infrastructure and delivery pipeline.
- `infrastructure/cloud-build` – non-GitHub validation and image release fallback.
- `docs/migrations/strata-feature-parity.md` – feature parity contract that must be complete before the standalone Strata application is retired.
- `docs/deployment/unified-platform-readiness.md` – unified release and cutover gates.

## Development

Use Node 22 and npm 10.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

The default application continues to use legacy authorities unless a guarded environment explicitly sets:

```bash
APPWRITE_BACKEND_MODE=foundation
```

or:

```bash
APPWRITE_BACKEND_MODE=appwrite
```

Server Appwrite credentials must be least-privilege secrets and must never be exposed through `VITE_` variables.

## Appwrite generation and Development validation

```bash
npm run appwrite:generate
npm run appwrite:validate
npm run appwrite:prepare:development
npm run appwrite:push:development
npm run appwrite:verify
npm run appwrite:audit:development
npm run appwrite:seed:development
npm run appwrite:test:development
```

All guarded commands positively identify the Sydney `ProInspect Development` project and reject the prohibited non-Development project.

## Validation

```bash
npm run check
npm run test:emulator
npm run test:e2e
```

When GitHub-hosted Actions capacity is unavailable, use the Google Cloud validation fallback documented in `docs/product/github-actions-quota-release-waiver.md`:

```bash
bash scripts/google-cloud-validate.sh PROJECT_ID
```

## Migration order

The platform migrates bounded domains in dependency order. The initial chain is:

```text
Agency → Clients → Managed Sites → Properties → Property Client Relationships → Client Contacts
```

Core Strata data then migrates:

```text
Managed Sites → People → Buildings/Units/Locations → Occupancies/Memberships → Operational Records → Evidence Metadata → Evidence Files
```

Every source record receives deterministic ID mapping and checksums. Migration is dry-run first, idempotent, resumable and reversible before authority changes.

## Releases

A code merge is not a production cutover. See:

- `docs/architecture/unified-proinspect-platform.md`
- `docs/migrations/strata-feature-parity.md`
- `docs/deployment/unified-platform-readiness.md`
- `docs/product/production-readiness-closeout.md`

The guarded non-Actions image release fallback is:

```bash
bash scripts/google-cloud-release.sh PROJECT_ID RELEASE_ID
```

Terraform remains authoritative for IAM, service accounts, secrets, networking, storage, scheduler configuration and environment controls.
