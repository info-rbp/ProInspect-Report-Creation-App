# Appwrite Development capability audit

## Scope and safety result

This audit was refreshed on 2026-09-02. The only target selected was the active Sydney project `ProInspect Development` (`proinspect-development`, region `syd`). The prohibited project `6a911f1e0031e90015b2` was not inspected, and no Production system was modified.

The refreshed source is the seven-portal merge candidate on `feat/seven-portal-completion-chatgpt`, combining the latest portal implementation with the strict unified-platform gates. The authoritative schema is generated from `tables/schema.mjs` plus `tables/unified-platform-extensions.mjs`.

The machine-readable companion is [appwrite-capability-audit.json](./appwrite-capability-audit.json).

## Live inventory after reconciliation

| Resource | Actual state |
| --- | --- |
| Target databases | 1 (`proinspect_core`) |
| Tables | 114 |
| Columns | 2,008 |
| Indexes | 366, all available |
| Native relationship columns | 0; explicit IDs are the canonical design |
| Buckets | 7 |
| Teams | 2, with 0 memberships |
| Functions | 0 |
| Webhooks | 0 |
| Registered platforms | 1 (`proinspect-localhost`) |
| Messaging providers/topics | 0 / 0 |
| API keys | 0 |
| Development users | 10; 0 email-verified and 0 MFA-enrolled |

All tables are enabled, have row security enabled, and have empty table permissions. The seven buckets have file security, encryption and antivirus enabled, empty bucket permissions, and matching size/extension policies. Remote and local database, table, column, index, bucket and Team definitions match in both directions.

Auth has email/password, invitations and JWT enabled. Anonymous, phone, magic URL and email OTP are disabled. TOTP, email and phone are available MFA factors; custom MFA is disabled. SMTP is enabled. The built-in Appwrite and Google OAuth providers are enabled. The ten Development users currently show zero verified and zero MFA-enrolled users.

## Final capability matrix

| Capability | Status | Existing implementation | Missing work | Target owner |
| --- | --- | --- | --- | --- |
| Authentication | PARTIAL | Email/password, invitations, JWT, localhost platform, synthetic users and live login/logout proof | SMTP-backed verification and recovery proof | Appwrite Auth / API |
| MFA/TOTP | AVAILABLE | TOTP factor, privileged denial policy, and live enrolment/challenge/recovery proof | Owner-controlled enrolment per privileged user | Appwrite Auth / API |
| Password recovery | PARTIAL | Browser SDK flow | SMTP and approved redirect | Appwrite Auth |
| Email verification | PARTIAL | Browser SDK flow | SMTP and approved redirect | Appwrite Auth |
| Agency memberships | AVAILABLE | Deny-by-default table and live seed rows | None for foundation | ProInspect API |
| Site memberships | AVAILABLE | Deny-by-default table and live seed rows | None for foundation | ProInspect API |
| RBAC/capabilities | PARTIAL | Server policy and negative unit tests | Active Appwrite identity/repository path and remaining domains | ProInspect API |
| Teams | AVAILABLE | Two coarse administrative/operations teams | Approved membership policy only | Appwrite Teams |
| TablesDB | AVAILABLE | 1 database, 114 tables, 2,008 columns | None | Appwrite TablesDB |
| Relationships | AVAILABLE | Explicit indexed IDs and migration parent checks | Per-command parent enforcement | ProInspect API |
| Indexes | AVAILABLE | 366 available indexes | None | Appwrite TablesDB |
| Transactions | PARTIAL | ServiceRequest plus AuditEvent | Remaining multi-record workflows | ProInspect API |
| Storage | AVAILABLE | Seven secured buckets | Temporary cleanup and large-file policy before Production | Appwrite Storage |
| File permissions | AVAILABLE | File security and explicit read grants | Repeat per-domain denial tests | API / Storage |
| Audit | PARTIAL | Table plus transactional foundation event | Append-only gateways for remaining domains | ProInspect API |
| Realtime | PARTIAL | WebSocket and explicit subscription wrapper | Domain channel builders and live denial test | Realtime / web |
| Functions | NOT_REQUIRED | Zero functions, matching the architecture | Re-evaluate only measured lightweight work | Appwrite later |
| Messaging | EXTERNAL | SendGrid/Twilio notification worker and in-app rows | Repository repoint after domain migration | Google Cloud |
| Shopify integration | EXTERNAL | Shopify authority, API HMAC/idempotency, target event tables | Appwrite-backed Development intake test | Shopify / API |
| Google Calendar | EXTERNAL | API OAuth/watch/event implementation | Appwrite adapter with intake migration | Google / API |
| Google Cloud workers | EXTERNAL | Specialist AI/PDF/document/notification/dashboard/integration services | Domain-by-domain repository repoint | Google Cloud |
| Migration framework | AVAILABLE | Dry run, deterministic IDs, checksums and idempotency | Batch checkpoints for real export | Migration tooling |
| Reconciliation | AVAILABLE | Source matrices and live schema verification | Approved source export and thresholds | Migration tooling |
| Development seed | AVAILABLE | Ten identities and scoped fixtures | Owner-controlled temporary password for repeat live auth | Development tooling |
| Backups/recovery | PARTIAL | Manual database archive and isolated 114-table/44-row restore rehearsal passed | File/bucket recovery and retention policy | Platform / owner |
| Retention/legal hold | PARTIAL | Immutable report/audit concepts | Owner/legal policy | Owner / API |
| Monitoring/logging | PARTIAL | Structured worker logs and status/exception/outbox tables | Appwrite alert/export and retry ownership | Operations |
| Development web platform | AVAILABLE | Source-controlled `proinspect-localhost` for `localhost` | Add real Development domains only when confirmed | Appwrite settings |
| API keys | AVAILABLE | Zero remaining keys | Preserve zero-key steady state | Project security |

## Ownership decisions

Appwrite owns identity, operational TablesDB data, Storage, coarse Teams, row/file permissions, audit persistence and selected Realtime. The ProInspect API owns business validation, capability enforcement, workflow transitions, high-value writes, audit creation and orchestration. Shopify remains financial authority. Google Cloud retains heavy and specialist processing.

Function candidates are deliberately classified as follows:

| Candidate | Owner now | Reason |
| --- | --- | --- |
| Shopify webhook intake and service routing | PROINSPECT API | Existing HMAC, idempotency and business routing belong at the API boundary. |
| Scheduled reminders and notification dispatch | GOOGLE CLOUD WORKER | Existing Pub/Sub/Scheduler, SendGrid and Twilio paths already provide delivery and retry behavior. |
| Integration-event processing | PROINSPECT API / GOOGLE CLOUD WORKER | Intake validation is API work; connector execution remains specialist worker work. |
| Migration and reconciliation | NOT NEEDED as Function | Operator-run, dry-run-first tooling is safer during migration. |
| Monthly operational report preparation | GOOGLE CLOUD WORKER | Document-heavy and potentially long-running. |
| Temporary-upload housekeeping | APPWRITE FUNCTION later | Lightweight and bounded, but only after lifecycle policy is approved. |

Appwrite Messaging is `EXTERNAL SERVICE RETAINED`: adding providers now would duplicate SendGrid/Twilio and the notification worker. Appwrite Realtime is `PARTIAL`: it is useful for requests, assignments, approvals, incidents, work orders and in-app notifications, but must wait for explicit permission-safe channels in the first activated UI domain.

## Google Cloud dependency matrix

| Worker | Current direct dependency | Target dependency | Migration required |
| --- | --- | --- | --- |
| AI worker | No direct Firestore/Storage access in entry point | ProInspect API task/result contract | Evaluate per AI domain |
| PDF worker | Firestore plus Firebase Storage | Appwrite-backed API and Storage | Yes |
| Document worker | Firestore plus Firebase Storage | Appwrite-backed API and Storage | Yes |
| Notification worker | Firestore, Secret Manager, SendGrid/Twilio | Appwrite event/API repository; external providers retained | Yes, by notification domain |
| Dashboard worker | Broad Firestore aggregation | Appwrite query/read-model API | Yes |
| Integration worker | Firestore plus Secret Manager and external PMS APIs | Appwrite integration repository/API | Yes |

No Production worker is changed by this audit.

## Remediation and live validation

The missing localhost platform was added through the guarded Development push and is now source-controlled. The target guard requires the exact project ID, name and Sydney endpoint and explicitly rejects `6a911f1e0031e90015b2`. Control-plane verification covers Auth methods, MFA factors, platforms, Functions, webhooks, Messaging and key counts. Schema verification now fails on local-to-remote or remote-to-local database, table, column, index, bucket and Team drift.

The current seven-persona workflow could not run because `APPWRITE_SEED_PASSWORD` was absent. The gate was not bypassed and the current `portal_entitlements` count is zero. Repository-side login/logout, verification, recovery, TOTP enrollment/challenge, recovery-code and provider-boundary tests pass, but live persona/MFA acceptance remains owner-blocked.

## Transactions, audit and migration

ServiceRequest plus AuditEvent is implemented as one Appwrite transaction. Quote approval, maintenance/work-order creation, report finalisation, Shopify order intake and incident closure remain `PARTIAL` because the current authoritative services still use Firestore transactions or have not yet been ported to the Appwrite repository boundary. Server keys can bypass row permissions, so final-report and audit immutability must remain API-enforced and tested.

The first bounded migration remains Agency → Clients → Managed Sites → Properties → Property Client Relationships → Client Contacts. Planning is side-effect-free, validates parent dependencies, generates deterministic IDs and checksums, and has idempotency tests. No Production migration is authorised.

## Backup, recovery and retention

Manual archive `6a97aa6887f4a1c23bf6` completed for `proinspect_core`. Its isolated restore reached `ready` with 114 matching table definitions, 44 matching rows and representative agency/site/service-request readability. The temporary restore database was removed and the archive retained. Binary file recovery, retention periods, legal hold, immutable audit retention and temporary-upload expiry remain unproven. Retention periods are an `OWNER DECISION REQUIRED`; the controlled Development seed password and real Development domains are `OWNER INPUT REQUIRED`.
