# Unified Platform Launch Report

Date: 2026-09-02

Branch: `feat/seven-portal-completion-chatgpt`

Candidate history: `6ce8b6ec` merged with the strict-gate work ending at `ec37c13d`

Source reference: `info-rbp/Strata-Site@1a1ab340e93f72f7662ba8b8ca8b007e0e519ad9`

Classification: **NOT_LAUNCH_READY**

This report does not authorise a Production deployment, data migration, traffic cutover,
worker switch, or archive of the standalone Strata repository. No Production, Staging,
Shopify webhook, Google Cloud worker, or prohibited Appwrite project was inspected or
changed.

## Repository validation

The merge candidate passes the local repository-controlled gates that are currently
implemented:

- Node 22.23.2 / npm 10.9.2 clean install baseline;
- format, ESLint and strict workspace TypeScript;
- 82 unit suites / 383 tests;
- 4 rules suites / 14 tests;
- Firebase/Storage emulator transition suite: 4 files / 10 tests;
- Playwright: 2/2 shell and fail-closed callback tests;
- all packages, web, API, AI, PDF, notification, dashboard, document and integration
  worker builds;
- built-artifact startup verification;
- 114-table Appwrite generation/config validation;
- repository secret scan and `git diff --check`.

These results prove compilation and the checked-in tests. They do not prove all legacy
Strata capabilities, live persona acceptance, or a Production-ready cutover.

## Appwrite Development reconciliation

The guarded live target was positively identified as active
`ProInspect Development` / `proinspect-development` in `syd` at
`https://syd.cloud.appwrite.io/v1`. The prohibited project
`6a911f1e0031e90015b2` was never accessed.

The live 100-table foundation was proven to be an exact subset of the source contract.
The bounded push added only the 14 missing unified-platform tables. The final
bidirectional verification passed with:

| Resource | Verified state |
| --- | ---: |
| Databases | 1 |
| Tables | 114 |
| Columns | 2,008 |
| Indexes | 366 |
| Buckets | 7 |
| Teams | 2 |
| Platforms | 1 |
| Functions | 0 |
| Webhooks | 0 |
| Persistent API keys | 0 |

No table, column, index, bucket, Team or platform drift remains. SMTP is enabled and
TOTP/email/phone MFA factors are available, but the ten Development users currently
show zero verified and zero MFA-enrolled users.

## Authentication and personas

Repository wiring now supports Appwrite sessions, email/password login/logout, email
verification, password recovery, TOTP enrollment/challenge, recovery codes, disabled
accounts, `${window.location.origin}` callbacks, and authoritative server membership
resolution. Provider-boundary and browser tests pass.

Live seven-persona acceptance is **BLOCKED_EXTERNAL** because
`APPWRITE_SEED_PASSWORD` is not configured. The guard was not bypassed, no synthetic
persona was granted broad access, and the live gate was not marked passed. The current
`portal_entitlements` row count is zero, so none of the seven personas has live
acceptance evidence from this run.

## Migration framework

The canonical framework provides stable target IDs, canonical serialization, source
and transformed checksums, deterministic batch planning, parent resolution, duplicate
rejection, partial-resume behavior, idempotent reruns, dry-run-only planning, and
explicit error reports. The first bounded plan remains:

Agency → Clients → Managed Sites → Properties → Property Client Relationships → Client Contacts

The framework and 49-table Strata disposition tests pass. No real D1/R2 or Production
data migration was performed.

## Transactions and immutable reporting

ServiceRequest plus AuditEvent has an Appwrite transaction and deliberate rollback
coverage. Firestore report transitions remain atomic during the transition period, and
domain/route tests reject direct mutation of final operational reports.

The Appwrite application boundary is not complete for all required high-value
operations. Atomic Appwrite-backed quote decisions/work-order issue, incident closure,
operational report finalisation and supersession, privileged role/scope changes,
contractor completion, and Shopify multi-record intake still require implementation
and rollback tests. Appwrite mode also still selects legacy Firestore report,
idempotency, task-outbox and upload-session implementations for some routes.

## Backup and restore

Manual archive `6a97aa6887f4a1c23bf6` completed on 2026-09-02 for
`proinspect_core` (60,384 bytes; database/table/index/column/row resources). An isolated
restore to temporary database `proinspect_restore_20260902` reached `ready`.

Source and restore matched at 114 tables, zero schema differences, and 44 total rows,
including representative agency, site and service-request counts. The temporary
restore database was then deleted; the completed archive remains. The Appwrite CLI
27.2.1 mis-decoded the restoration `options` field even though the server completed the
job, so restore monitoring used the destination database state. File/bucket recovery
was not rehearsed.

## Feature parity

The parity verifier now distinguishes genuine external blockers from unfinished
engineering and enforces the required final status vocabulary. Current counts are:

| Status | Count |
| --- | ---: |
| `COMPLETE` | 1 |
| `RETIRED_WITH_APPROVAL` | 0 |
| `EXTERNAL_BY_DESIGN` | 0 |
| `BLOCKED_OWNER_INPUT` | 1 |
| `ENGINEERING_INCOMPLETE` | 33 |

The one owner blocker is the controlled Development authentication secret/identities.
The 33 engineering entries are not hidden as owner actions. The standalone Strata
application therefore cannot be archived.

## Final decision

The Development backend is not complete. Live schema and database recovery are now
proven, and the implemented local gates pass, but authenticated seven-persona
acceptance and substantial application/transaction/feature-parity work remain. Keep
the pull request Draft, preserve all legacy source and routing, and do not start a real
data cutover.
