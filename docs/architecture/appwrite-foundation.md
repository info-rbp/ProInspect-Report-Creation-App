# Appwrite foundation architecture

## Status and authority

Appwrite is prepared as the future canonical operational backend but is not active as the production source of truth. During this foundation phase:

- Firebase Auth, Firestore, and Firebase Storage remain authoritative for ProInspect.
- Cloudflare D1 and R2 remain authoritative for Building Management/Strata.
- Shopify remains authoritative for catalogue, pricing, checkout, payments, refunds, and financial order state.
- Google Cloud continues AI, large PDF, document-heavy, and long-running processing.
- No permanent dual-write path is introduced.

The target request path is React → ProInspect API → domain/service layer → Appwrite repositories. Browser SDK support is limited to authentication, explicitly permitted reads, Realtime, and downloads authorised by file-level permissions. Evidence upload and all sensitive writes remain behind the API.

## Environments

Development, Staging, and Production use separate Appwrite projects and API keys. The checked-in configuration cannot target a live project. Only a positively identified `Development` project may be materialized and pushed by the supplied scripts. Staging and Production promotion requires separate configuration and approval.

## Canonical data model

`proinspect_core` contains 100 source-controlled foundation, client/property, service request, inspection, maintenance, Building Management, audit, integration, evidence metadata, and migration identity tables after source reconciliation. Explicit `agencyId`, `managedSiteId`, and `propertyId` columns are retained where relevant rather than depending on deep relationship chains. Structured domain snapshots and provider payload references use API-validated JSON text where relational decomposition would damage workflow semantics.

Standalone properties have a nullable `managedSiteId`. The optional physical hierarchy is managed site → building → level → area; the repository's existing property layout/version model remains the source for future detailed conversion.

Final report versions and final operational reports are immutable by API policy. Appwrite server keys can technically bypass row permissions, so immutability must also be enforced in the ProInspect API, audited, tested, and limited by key scope.

## Identity and permissions

Identity is Appwrite Auth plus `user_profiles`, `agency_memberships`, and `site_memberships`. Appwrite Teams are coarse administrative/resource groups, not the business capability model. The canonical decision order remains:

1. authenticated active identity;
2. required MFA for privileged roles;
3. active agency/site membership and validity window;
4. server-side role/capability policy;
5. assignment and entity scope;
6. workflow/lifecycle state and separation of duties;
7. Appwrite row/file permissions;
8. append-only audit event after a successful material action.

All tables have empty table permissions and row security enabled. All buckets have empty bucket permissions and file security enabled. Server-created rows grant only explicit read permissions to users/teams; the helper rejects client create/update/delete/write grants. This preserves deny-by-default and keeps sensitive mutations on the API.

The future role vocabulary extends the current code roles with Building Management, resident, client, and contractor concepts. Those new labels are schema-ready but must not become production capabilities until `@pcr/domain`, the API policy, tests, and the product role matrix are updated together.

## Auth

Development configuration enables email/password, invitations, JWT, password history, dictionary checks, personal-data checks, and session alerts; anonymous, phone, magic URL, and email OTP are disabled. Email verification and password recovery require approved platform return URLs and outbound email configuration. TOTP MFA and recovery codes are application flows. Privileged membership resolution must reject a password-only session without verified MFA evidence.

Existing Firebase passwords are not copied. User migration requires a separately approved supported hash migration or reauthentication/password reset flow, plus MFA enrolment for privileged users.

## Storage

Binary evidence stays in Storage, never TablesDB. The `evidence_files` table records ownership, entity links, checksums, sizes, legacy IDs, and capture metadata. Buckets are split by operational purpose, enforce extension/size limits, enable file security, encryption, and antivirus, and grant no bucket-wide access. Files over Appwrite's encryption/antivirus processing threshold require a documented compensating control or tighter size policy before Production.

`temporary-uploads` requires lifecycle cleanup before Production. Final report objects are API-created, content-hashed, and treated as immutable; corrections create a new report version.

## Transactions, events, and Realtime

ServiceRequest creation and its AuditEvent are staged in one Appwrite transaction by `AppwriteFoundationService`. Quote approval, work-order creation, Shopify paid-order routing, and similar multi-row transitions should follow the same pattern after their domain services are implemented.

`integration_events` and `integration_deliveries` use unique provider deduplication keys. `integration_outbox` provides retryable post-commit delivery without permanent dual-write. Realtime subscriptions are explicit and limited to operational UI needs such as requests, assignments, approvals, incidents, and work-order changes.

## Functions boundary

No Appwrite Function is deployed in this phase. Suitable later candidates are webhook intake, routing, notifications, reminders, retries, reconciliation, housekeeping, and monthly report preparation. Heavy or long-running workloads remain on Google Cloud until measured and separately approved.

## Cutover and rollback

Each domain follows: legacy source → dry-run mapping → Development import → reconciliation → Staging rehearsal → approved production import/catch-up → Appwrite authoritative → legacy read-only → archive → decommission. A temporary bounded catch-up window may be used, but permanent two-way synchronization is prohibited.

Rollback before authority switch deletes only imported target rows using `migration_id_map`. After authority switch, rollback restores the legacy source from the frozen cutover checkpoint and replays reconciled events under an approved runbook; it never silently writes both systems.

## Unresolved decisions

- Approve the remaining Building Management/Strata unit-to-inspectable-property and data-retention decisions documented in `appwrite-source-reconciliation.md`.
- Choose Appwrite Development/Staging/Production project IDs and confirm Australian data-location requirements.
- Approve the expanded role/capability matrix and Teams provisioning policy.
- Decide evidence size limits where Appwrite encryption/antivirus processing thresholds are lower than operational upload needs.
- Define SMTP, verified domains, recovery URLs, and privileged MFA enrolment policy.
- Define retention, legal hold, backup/export, and deletion rules.
- Select the first bounded domain for migration and its cutover success/rollback thresholds.
