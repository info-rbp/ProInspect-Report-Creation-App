# Codex completion runbook: unified ProInspect platform

Use this runbook inside a local VS Code workspace opened at the root of `ProInspect-Report-Creation-App`.

The draft implementation is on branch:

`feat/unified-proinspect-strata-platform`

The draft pull request is #61.

## Objective

Finish, compile, validate and deploy the unified ProInspect application that absorbs the standalone Strata application into the canonical monorepo. Preserve seven role-specific portals over one identity, API, Appwrite backend and shared domain model. Do not perform a Production cutover until every gate in `docs/deployment/unified-platform-readiness.md` is evidenced.

## Safety requirements

- Do not modify Appwrite project `6a911f1e0031e90015b2`.
- Only mutate `ProInspect Development` (`proinspect-development`, Sydney) while completing Development work.
- Do not switch production Shopify webhooks.
- Do not disable or delete Firebase, Firestore, Firebase Storage, D1 or R2.
- Do not modify production Google Cloud workers.
- Do not migrate or log legacy password hashes, session tokens, API keys or OAuth secrets.
- Keep the draft PR unmerged until validation and review pass.
- Use short-lived, least-privilege Appwrite credentials and remove them after use.

## 1. Establish a clean local baseline

1. Fetch and check out `feat/unified-proinspect-strata-platform`.
2. Record the exact branch commit and compare it with PR #61.
3. Run `git status --short` and preserve all existing changes.
4. Run `npm ci --ignore-scripts --no-audit --no-fund` with Node 22 and npm 10.
5. Run `npm run format` before diagnosing lint/type errors.
6. If the standalone Strata history has not yet been imported, add `info-rbp/Strata-Site` as a temporary remote and import it under `legacy/strata-site` with history preservation. Do not execute code from the legacy subtree. Record the exact source commit in the parity document.

## 2. Compile and repair the branch

Run these individually and fix every failure rather than suppressing it:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:rules
npm run appwrite:validate
npm run build
npm run verify:dist
```

Pay particular attention to:

- Appwrite Web SDK `Account.createJWT` response/signature in `packages/appwrite-client/src/auth.ts`.
- node-appwrite `Client.setJWT` and `Account.get()` typing in `apps/api/src/security/appwriteIdentity.ts`.
- `SecurityRole` replacing `UserRole` across people, profile, invitation and UI code.
- `OperationalRepository.list` optional filter argument across every implementation and test double.
- API route imports and cyclic package dependencies.
- Appwrite extension table IDs, column limits, enum/string sizes and compound indexes.
- React Router route conflicts between the seven portal routes and legacy `/app/*` routes.
- idempotency tests that reuse servers or closed listeners.
- format/lint issues introduced by generated JSON or long TypeScript expressions.

Do not cast away domain or security errors merely to make TypeScript green.

## 3. Finish the browser identity provider switch

The branch includes:

- Appwrite browser services and Auth helpers;
- `apps/web/services/appwriteAuth.ts`;
- Appwrite JWT verification in the API;
- `AUTH_PROVIDER=appwrite` server mode;
- Appwrite memberships, portal entitlements and audit adapters.

Complete the UI/provider wiring:

1. Refactor `apps/web/contexts/AuthContext.tsx` so `VITE_AUTH_PROVIDER` selects `firebase` or `appwrite`.
2. Preserve the existing Firebase login/MFA path while it remains a migration fallback.
3. In Appwrite mode:
   - restore the current Appwrite session on startup;
   - expose email/password login and logout;
   - expose short-lived Appwrite JWTs to the API client;
   - load the UI profile from account preferences only as a display/bootstrap aid;
   - treat API-resolved memberships and portal entitlements as authority;
   - show a clear MFA challenge/enrolment path using the existing Appwrite Auth helpers;
   - require verified email and MFA for privileged roles.
4. Update `apps/web/services/apiClient.ts` so it obtains a Firebase ID token or Appwrite JWT according to the selected provider.
5. Update the login route/component without removing current Firebase support.
6. Add and document:
   - `VITE_AUTH_PROVIDER=firebase|appwrite`
   - `AUTH_PROVIDER=firebase|appwrite`
7. Add `/auth/verify-email` and `/auth/reset-password` callback pages using `window.location.origin`.
8. Add unit and browser tests for both providers, including logout, expired token, failed MFA, recovery and portal routing.

Do not make Appwrite user preferences the authoritative source of role or site scope.

## 4. Reconcile and deploy the 114-table Development schema

The canonical 100-table foundation is extended by 14 source-controlled unified-platform tables:

- portal entitlements;
- contractor compliance;
- offer partners/offers/redemptions;
- conversations/participants/messages;
- notification preferences;
- appointment availability/bookings;
- route plans/stops;
- offline sync receipts.

Run:

```bash
npm run appwrite:generate
npm run appwrite:validate
```

Review the generated diff, then use the guarded Development commands:

```bash
npm run appwrite:prepare:development
npm run appwrite:push:development
npm run appwrite:verify
npm run appwrite:audit:development
```

Requirements:

- target project must be exactly `ProInspect Development` / `proinspect-development` / Sydney;
- 114 tables must be present with no drift in either direction;
- all indexes must become `available`;
- seven buckets remain deny-by-default, encrypted, antivirus-enabled and file-secured;
- zero persistent broad API keys remain;
- the prohibited project guard must still reject `6a911f1e0031e90015b2`.

Do not add Appwrite Functions or Messaging providers merely to duplicate retained Google Cloud/SendGrid/Twilio behavior.

## 5. Finish Appwrite API adapters and domain services

For every route introduced under `/api/v1/building/*` and `/api/v1/platform/*`:

- confirm Appwrite table mapping;
- confirm agency filter plus the narrowest supported site/client/user/contractor/assignment filter;
- confirm row/file permissions or API-only access design;
- confirm idempotency key behavior;
- confirm optimistic version handling;
- confirm allow and deny audit events;
- confirm no server-key path can mutate immutable final reports or audit history;
- replace generic CRUD with dedicated commands wherever lifecycle, approval, assignment or financial meaning exists.

Implement or complete dedicated services for:

- operational report finalisation and supersession;
- operational quote approval and work-order creation as an atomic transaction;
- incident closure and follow-up creation;
- contractor compliance enforcement during assignment and sign-in;
- access-device issue/return history;
- move approval, setup, inspection and closure;
- asset service-event generation from maintenance plans;
- conversation participant checks, not only site/client filters;
- offer eligibility/redemption limits and privacy-safe partner handoff;
- appointment reservation capacity and rescheduling;
- route plan optimisation contract;
- offline receipt conflict and retry workflow.

## 6. Finish the seven portal feature implementations

The branch provides portal definitions, routes, switcher and shared API clients. Replace generic workspace cards with production feature screens, reusing existing shared features rather than copying them per portal.

### Admin

Complete service requests, managed sites, contractors/compliance, operational reporting, offers, portal entitlements, audit and integration exceptions.

### Inspector

Complete Today, schedule, assigned inspections, capture, evidence queue, identified issues, report drafts, key/access instructions and sync state.

### Building Management

Complete Today, activity, quick forms, tasks, common-area inspections, defects, work orders, contractors, moves, residents/units, access/keys, incidents, by-laws, waste, assets/plans, monthly reports and handover.

### Strata

Complete dashboard, reports, approvals, maintenance, contractors, residents/moves, access, incidents, by-laws, notices, documents, users and audit.

### Resident

Merge tenant and resident experiences: property/unit, requests, maintenance, inspections, bookings, access devices/keys, documents/signing, messages, notices, household/profile and eligible offers. Enforce private/unit/published request visibility.

### Client

Make the existing portal actionable: service requests, booking/rescheduling, approvals, quotes, access instructions, messages, uploads and downloads.

### Contractor

Complete assigned work, schedule, access instructions, check-in/out, keys, quotes, evidence, findings, completion, compliance documents and job history.

Add accessible loading, empty, error and denied states. Test mobile layouts, keyboard navigation and screen-reader labels.

## 7. Complete offline and PWA behavior

Build a shared encrypted local queue for Inspector and Building Management workflows:

- download assigned work;
- save local drafts;
- capture evidence while offline;
- show waiting/uploading/synced/conflict/failed states;
- retry idempotently;
- detect payload conflicts;
- recover after browser restart;
- prevent duplicate submissions;
- never cache broader data than the authenticated assignment/site scope.

Test iPhone Safari, Android Chrome, tablet and desktop. Test camera uploads and reconnect behavior.

## 8. Execute the Strata D1/R2 migration in Development

Use `infrastructure/appwrite/migrations/strata-d1-manifest.mjs` as the complete 49-table source contract.

1. Export a Development or approved production-shaped D1 snapshot without secrets.
2. Inventory all 49 arrays and reject unknown/missing tables.
3. Resolve owner decisions:
   - whether every D1 unit creates an inspectable ProInspect property;
   - final role mapping, especially `system_administrator`;
   - whether historic notifications/outbox/form payloads must be retained;
   - maintenance-plan convergence;
   - retention/legal-hold periods.
4. Implement each transform with deterministic IDs, parent checks and `migration_id_map` writes.
5. Dry-run first.
6. Import into Development only.
7. Reconcile source/target counts, checksums and relationships.
8. Rerun and prove zero duplication.
9. Export the R2 object inventory, copy to Appwrite Storage, verify SHA-256 checksums and deny unauthorized reads.
10. Rehearse rollback before changing any application authority.

Never migrate D1 sessions or password hashes.

## 9. Generalise Shopify into ServiceRequest routing

Keep Shopify as financial authority. Extend the existing replay-safe connector so every mapped order line resolves:

`Shopify Product/Variant → ShopifyServiceMapping → ServiceDefinition → ServiceRequestItem → Workflow Factory`

Cover inspection, maintenance, access control, leasing/admin, tenancy documents, Building Management and Strata services.

Add Development fixture tests for:

- valid and invalid HMAC;
- duplicate delivery ID;
- paid/cancelled/refunded events;
- multiple line items;
- unknown/inactive mapping;
- missing property/site information;
- draft ServiceRequest correlation ID from checkout metadata;
- exception queue and reconciliation.

Do not switch production webhooks in this phase.

## 10. Repoint retained Google Cloud workers

Keep specialist workers, but remove direct Firestore/Firebase Storage dependencies for each cut-over domain:

- PDF worker → Appwrite-backed report API/Storage;
- document worker → Appwrite-backed document/evidence API;
- notification worker → Appwrite events/repositories while retaining approved providers;
- dashboard worker → Appwrite query/read-model API;
- integration worker → Appwrite integration state and secret references;
- AI worker → confirmed Appwrite-backed task/result contracts.

Add a worker dependency matrix and tests proving no migrated domain is written back to Firestore.

## 11. Development and Staging deployment

Complete external owner configuration:

- HTTPS Development frontend domain;
- custom Appwrite Development API domain;
- registered Web platforms;
- SMTP provider, verified sender/domain, verification and recovery templates;
- Google Calendar redirect URLs;
- backup schedule and restore rehearsal;
- retention/legal-hold rules;
- upload size/cleanup policy;
- alerting and support ownership.

Deploy Development, run smoke/E2E/negative tests, then create Staging from source-controlled configuration and rehearse the complete migration/cutover there.

## 12. Final validation

Run:

```bash
npm run check
npm run test:emulator
npm run test:e2e
npm run appwrite:verify
npm run appwrite:audit:development
npm run appwrite:test:development
npm run security:scan
```

If GitHub Actions still fails before obtaining a runner, use:

```bash
bash scripts/google-cloud-validate.sh PROJECT_ID
```

Attach results to PR #61. Do not mark the PR ready until all branch checks are green.

## Required final report

Report:

- branch and final commit;
- files changed;
- test/build commands and results;
- Appwrite project and final resource counts;
- portal feature parity by portal;
- D1/R2 migration counts/checksums/errors;
- Shopify fixture results;
- worker repoint status;
- Development/Staging URLs and smoke results;
- owner actions still required;
- rollback evidence;
- anything blocking Production.

Do not merge PR #61 or perform Production cutover automatically.
