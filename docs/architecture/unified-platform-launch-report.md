# Unified Platform Launch Report

Date: 2026-08-31

Branch: `feat/unified-strata-platform-chatgpt`

Tested implementation commit: `ce7e0e3dd6d33d7001a391383581624a5170659b`

Source reference: `info-rbp/Strata-Site@1a1ab340e93f72f7662ba8b8ca8b007e0e519ad9`

Classification: **NOT_LAUNCH_READY**

This report records the state of the consolidation branch. It does not authorise a
Production deployment, data migration, traffic cutover, worker switch, or archive of
the standalone Strata repository. The report itself is committed after the tested
implementation commit, so the final hand-off must record the resulting metadata-only
commit separately.

## Executive decision

The branch has a useful unified-platform foundation, seven portal entry points, a
generated Appwrite contract, strict migration-planner primitives, and a fail-closed
feature-parity register. It is not ready for launch because the majority of Strata
capabilities remain incomplete or unproven and the required live Development,
migration, immutable-record, scope-denial, worker, recovery, offline/device, and
integration gates have not passed.

No Production system was mutated during this assessment. No live Shopify webhook was
switched. No D1, R2, Firestore, Firebase Storage, Google Cloud worker, or Appwrite
Production write was performed. The standalone Strata source remains a read-only
reference and must not be archived.

## Capabilities implemented and verified locally

- The React application exposes portal entry points for `/admin`, `/inspector`,
  `/building`, `/strata`, `/resident`, `/client`, and `/contractor` through a shared
  portal shell and entitlement-aware platform contracts.
- The local generated Appwrite contract contains 114 tables, seven deny-by-default
  buckets, and one Development web-platform definition.
- Shared domain foundations cover the principal operational entities and preserve the
  required distinctions between property inspections and operational inspections,
  property reports and operational reports, maintenance items and defects, and
  maintenance plans and preventive maintenance.
- Appwrite authentication, identity, dashboard-role, web profile, and legacy internal
  user-directory type boundaries compile under strict checks.
- Migration helpers now provide deterministic identifiers, canonical checksums,
  fail-closed duplicate-source detection, and idempotent unchanged-record planning.
- The feature-parity verifier fails closed on missing capabilities, invalid statuses,
  duplicate entries, missing implementation/test evidence, and owner-blocked entries
  without explicit owner actions.

These foundations do not constitute end-to-end implementation of the workflows listed
in the completion brief.

## Feature-parity status

The canonical register is
[`docs/migrations/strata-feature-parity.json`](../migrations/strata-feature-parity.json),
validated by `scripts/verify-strata-feature-parity.mjs`.

| Status | Count |
| --- | ---: |
| `COMPLETE` | 1 |
| `BLOCKED_OWNER_INPUT` | 34 |
| `RETIRED_APPROVED` | 0 |
| `IN_PROGRESS` | 0 |
| **Total** | **35** |

The sole `COMPLETE` entry is the shared seven-portal shell. The 34 blocked entries each
record owner actions and remaining engineering work. `BLOCKED_OWNER_INPUT` must not be
read as feature completion: it records that launch approval cannot proceed without the
specified input and subsequent implementation and verification.

## Appwrite resources and drift

| Gate | Result | Evidence or limitation |
| --- | --- | --- |
| Local Appwrite generation | PASS | 114 tables, 7 buckets, 1 Development platform |
| Static Appwrite validation | PASS | `npm run appwrite:validate` |
| Exact Development target guard | PRESENT | Writers require the approved Development target |
| Live schema verification | NOT TESTED | No current least-privilege Development API key and exact confirmation were supplied |
| Live configuration verification | NOT TESTED | Installed Appwrite CLI is 21.0.1 while the audit requires 27.2.1 |
| Current source/remote drift result | UNPROVEN | No fresh remote snapshot was authorised or available |

The older 100-table reconciliation evidence predates the branch extensions and cannot
prove the current 114-table target. Project `6a911f1e0031e90015b2` was not accessed or
modified. Any future live run must prove the exact `proinspect-development` target
before its first write and use a temporary least-privilege credential.

## Migration rehearsal and reconciliation

The Strata source reference contains 49 D1 tables, 21 indexes, two immutable operational
report triggers, and an R2 evidence bucket contract. Its routes, middleware, migrations,
seed structure, domain code, and object-storage paths were inventoried as migration
references only.

No owner-approved synthetic or Development export was supplied, so no record migration,
binary copy, or identity invitation run was applied. Consequently:

- migrated row counts and source/target checksums: **NOT AVAILABLE**;
- duplicate and orphan reports from representative data: **NOT RUN**;
- resumable checkpoint and idempotent rerun proof: **NOT RUN**;
- `migration_id_map` reconciliation using representative data: **NOT RUN**;
- R2/Firebase Storage binary copy and checksum reconciliation: **NOT RUN**;
- invitation/activation of Appwrite identities: **NOT RUN**;
- source deletion and password/session migration: **PROHIBITED AND NOT PERFORMED**.

The migration order in the completion brief remains mandatory. The source systems must
remain intact until counts, checksums, dependencies, duplicate/orphan handling,
restarts, and rollback have all passed against approved non-Production material.

## Portal and permission testing

The current Playwright suite contains one unauthenticated body-rendering smoke test. It
passed locally, but it is not evidence for authenticated portal acceptance.

| Portal | Route shell | Authenticated workflow E2E | Role/scope denial matrix |
| --- | --- | --- | --- |
| Admin | PRESENT | NOT TESTED | NOT TESTED end to end |
| Inspector | PRESENT | NOT TESTED | NOT TESTED end to end |
| Building Management | PRESENT | NOT TESTED | NOT TESTED end to end |
| Strata | PRESENT | NOT TESTED | NOT TESTED end to end |
| Resident | PRESENT | NOT TESTED | NOT TESTED end to end |
| Client | PRESENT | NOT TESTED | NOT TESTED end to end |
| Contractor | PRESENT | NOT TESTED | NOT TESTED end to end |

The route shell and contract tests do not prove that every state-changing route enforces
the required identity, entitlement, capability, scope, validation, atomic write, and
audit chain. Legacy routes must remain until redirects, deep links, permissions, and
feature parity pass.

## Security results

- Formatting, linting, strict type checks, unit tests, Firebase rules tests, local demo
  emulator tests, all package/application/worker builds, and built-artifact smoke checks
  passed in the local validation sequence.
- Static Appwrite validation and the repository secret scan passed.
- The emulator run was local and used a demo project only; it did not mutate remote
  Firebase or Firestore.
- `npm audit --omit=dev` reports five moderate Production dependency findings and no
  high or critical findings.
- The full dependency-tree audit reports seven moderate, one high, and one critical
  finding; the high and critical paths are in Development tooling through
  `firebase-tools`/`tar`. No forced dependency rewrite was applied.
- A complete cross-agency, cross-site, cross-building, cross-unit, and cross-portal
  denial matrix has not been executed against Development identities.
- Privileged MFA enrolment/recovery, verification, recovery callbacks, invitations,
  permission-safe Realtime subscriptions, and zero-persistent-broad-key control-plane
  proof remain unverified.

## Immutable records and atomic workflows

The source and target contracts recognise immutable operational releases and audit
events, but the following atomic Development proofs remain incomplete:

- quote approval with operational work-order creation;
- key issue and return;
- move approval;
- incident closure;
- operational report finalisation, distribution, acknowledgement, and supersession;
- Shopify intake with workflow creation and delivery deduplication;
- privileged role and scope changes.

Launch remains blocked until final operational reports and audit events are proven
immutable in storage and supersession is demonstrated without in-place mutation.

## Offline and device results

The source PWA offers shell caching and local draft behaviour, but it does not prove the
required shared offline layer. Encrypted/local draft policy, deterministic idempotency,
pending-operation and evidence queues, retry/backoff, restart recovery, server conflict
detection, user-resolvable conflicts, and duplicate prevention after reconnect are not
complete as an integrated Inspector/Building Management workflow.

Manual iOS and Android acceptance was not performed. Device testing must cover cold
start, interrupted upload, process restart, network flapping, duplicate taps, conflict
resolution, stale entitlements, large evidence, background/foreground transitions, and
the visible `Synced`, `Waiting`, `Uploading`, `Conflict`, and `Failed` states.

## Integration and worker results

- The live Shopify webhook was not changed.
- The full Development replay suite for signature validation, delivery deduplication,
  paid/cancelled/refunded/updated events, multiple items, unknown mappings, missing
  property/client data, routing, exception handling, and reconciliation is incomplete.
- Domain-by-domain worker adapters have not all been repointed from direct
  Firestore/Storage access to the canonical API/Appwrite repositories. PDF, document,
  notification, dashboard, and integration workers therefore remain a launch blocker.
- No Production worker was deployed or mutated.

## Backup, restore, observability, and file policy

The following operational acceptance evidence is missing:

- approved backup schedule, retention, ownership, and alerting;
- Appwrite database restore rehearsal with measured recovery results;
- file recovery rehearsal and checksum verification;
- temporary-upload cleanup proof;
- approved file size/type and evidence-retention policies;
- real HTTPS Development frontend and registered web-platform proof;
- approved custom Appwrite API domain, if required;
- structured logging, correlation-ID propagation, dashboards, and alert ownership.

## Owner actions

Before engineering can close the blocked parity entries, the owner must provide or
approve:

1. temporary least-privilege Appwrite Development credentials, exact target
   confirmation, Development test identities, and required MFA recovery material;
2. a real HTTPS Development frontend domain, callback URLs, mail/SMTP settings, and any
   approved custom Appwrite API domain;
3. synthetic or Development-only D1 and storage exports with source counts/checksums and
   permission to run rehearsals;
4. business decisions for lifecycle mappings, portal entitlement assignments, service
   routing, offer eligibility, immutable report sign-off, and approved retirements;
5. Shopify Development fixtures/mappings and replay identifiers, without changing the
   live webhook;
6. backup, recovery, retention, file policy, logging, alert ownership, and recovery
   objectives;
7. representative iOS/Android devices and acceptance users for every portal and scope.

Owner input does not by itself complete a capability. Engineering, automated tests,
Development rehearsal, and evidence review must follow.

## Rollback and preservation

Until cutover approval, rollback is preservation: keep the standalone Strata repository,
D1/R2 data, Firebase/Firestore/Storage data, worker deployments, and live routing
unchanged. Keep new Appwrite-backed routes and writers behind explicit entitlements or
feature controls.

For a future rehearsed cutover:

1. stop new canonical intake using the approved reversible control;
2. preserve logs, checkpoints, `migration_id_map`, counts, and checksums;
3. disable only the new portal/workflow control plane and restore the previously proven
   routing configuration;
4. reverse target records only through a reviewed migration-specific compensating plan,
   never by deleting source data;
5. reconcile both systems before resuming writes;
6. retain the Strata repository and source stores until the rollback window closes and
   the owner separately approves archive.

This rollback has not been rehearsed with representative data and is therefore a plan,
not launch evidence.

## Final blockers and classification

The final classification is **NOT_LAUNCH_READY**. At minimum, all of the following must
be proven before that classification can change:

- lossless migration and binary reconciliation with counts and checksums;
- complete role/capability/scope denial coverage;
- immutable operational-report and audit-event enforcement with atomic supersession;
- canonical API/Appwrite worker routing without unapproved direct legacy writes;
- database and file backup/restore rehearsals;
- authenticated E2E coverage for all seven portals and retained legacy redirects;
- offline/reconnect/device acceptance without duplicate submissions;
- complete Shopify Development replay and exception reconciliation;
- verification, recovery, invitations, privileged MFA, and Development domain proof;
- closure of every `BLOCKED_OWNER_INPUT` parity entry with implementation and tests, or
  an explicitly approved retirement.
