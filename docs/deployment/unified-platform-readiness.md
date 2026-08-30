# Unified platform deployment readiness

The code merge is not a production cutover. Deployment is approved only after every gate below has evidence attached to the release candidate.

## Repository and build

- [ ] Merge branch is current with `main` and reviewed.
- [ ] No production code imports or executes from a legacy Strata subtree.
- [ ] `npm run check` passes.
- [ ] `npm run test:emulator` passes while Firebase remains a migration source.
- [ ] `npm run appwrite:generate`, `npm run appwrite:validate`, and live schema verification pass.
- [ ] Secret scan passes and zero secrets are committed.
- [ ] Web, API and all workers build from a clean checkout.
- [ ] Built-artifact startup verification passes.

## Appwrite

- [ ] Development and Staging schemas match the source-controlled 100-table baseline plus approved extensions.
- [ ] Seven Storage buckets remain encrypted, antivirus-enabled, file-secured and deny-by-default.
- [ ] Real Development and Staging web platforms/custom domains are registered.
- [ ] SMTP-backed verification and recovery pass.
- [ ] Privileged MFA enrolment, challenge and recovery pass.
- [ ] Backup policy exists and a restore rehearsal has succeeded.
- [ ] No persistent broad API key remains.
- [ ] Appwrite operational API mode has passed bounded-domain E2E tests.

## Identity and portal access

- [ ] One identity can hold multiple agency/site/client/occupancy/assignment relationships.
- [ ] Portal resolver sends each role to an authorised workspace.
- [ ] Admin, Inspector, Building, Strata, Resident, Client and Contractor portals have positive E2E tests.
- [ ] Cross-agency, cross-site, cross-client, cross-unit, cross-contractor and cross-inspector denial tests pass.
- [ ] Relief Building Manager access expires automatically.
- [ ] Resident reads require verified current occupancy or explicit grant.
- [ ] Contractor reads require assignment or own attendance/upload.
- [ ] Strata/Council decisions remain distinct from Building Manager operations.

## Workflow integrity

- [ ] Defect lifecycle and closure gates pass.
- [ ] Operational work-order lifecycle passes.
- [ ] Contractor sign-out blocks outstanding keys without audited override.
- [ ] Move closure requires returned access items and post-move inspection.
- [ ] Access-device request lifecycle passes.
- [ ] Quote/approval/work-order creation is atomic.
- [ ] Incident closure and required follow-up are audited.
- [ ] Final property and operational reports are immutable; supersession is tested.
- [ ] Audit events are append-only through API gateways.
- [ ] Retry/idempotency tests pass for every material command.

## Data migration

- [ ] Every D1 table has an approved transform.
- [ ] Every source record has deterministic legacy-ID mapping.
- [ ] Source/target counts and checksums reconcile.
- [ ] Missing-parent and duplicate reports are empty or owner-approved.
- [ ] R2 inventory is complete.
- [ ] R2-to-Appwrite file checksums reconcile.
- [ ] File permissions are tested after migration.
- [ ] Migration reruns create no duplicates.
- [ ] Rollback rehearsal succeeds before authority switches.
- [ ] Final delta plan is documented and rehearsed.

## Shopify and integrations

- [ ] Shopify remains catalogue/payment authority.
- [ ] Product/variant mappings cover every active service intended for launch.
- [ ] Valid HMAC, invalid HMAC, duplicate delivery, payment, cancellation, refund and unknown mapping tests pass.
- [ ] Generic ServiceRequest routing passes for inspection, maintenance, access, leasing/admin and Building Management services.
- [ ] Google Calendar callback/watch/event flows pass in Staging.
- [ ] Integration exceptions and reconciliation are visible to Operations.

## Workers

- [ ] PDF worker reads/writes through Appwrite-backed API/Storage for cut-over domains.
- [ ] Document worker uses Appwrite-backed document/evidence records.
- [ ] Notification worker reads Appwrite-backed events while retaining the approved external provider.
- [ ] Dashboard worker reads Appwrite query/read-model APIs.
- [ ] Integration worker uses Appwrite integration records and secret references.
- [ ] AI worker task/result contracts are confirmed for migrated domains.
- [ ] No cut-over worker writes migrated domains back to Firestore or Firebase Storage.

## Field and mobile operation

- [ ] Inspection draft survives refresh/restart offline.
- [ ] Building Management operational form draft survives refresh/restart offline.
- [ ] Evidence queue shows waiting/uploading/synced/conflict/failed state.
- [ ] Reconnect and retry are idempotent.
- [ ] iPhone Safari, Android Chrome, tablet and desktop tests pass.
- [ ] Camera upload, file-size and file-type controls pass.
- [ ] PWA installation and update behavior are verified where supported.

## Operational readiness

- [ ] Retention and legal-hold policy is approved.
- [ ] Temporary-upload cleanup is implemented.
- [ ] Monitoring, alerts, retry ownership and support escalation are documented.
- [ ] Incident and rollback runbooks are available.
- [ ] Support staff can identify current data authority by domain.
- [ ] D1/R2/Firestore remain recoverable during the agreed rollback window.

## Cutover sequence

1. Freeze standalone Strata writes.
2. Take D1/R2 and Appwrite backups.
3. Run final D1/R2 delta migration.
4. Reconcile counts, checksums, relationships and permissions.
5. Enable unified portal routes and Appwrite authority flags.
6. Run production smoke and denial tests.
7. Observe error, outbox, webhook and worker queues.
8. Retain rollback sources read-only for the approved window.
9. Archive the standalone deployment and repository only after sign-off.

A release is `READY` only when all launch-blocking gates are green. Features explicitly classified as post-launch, such as full amenity booking, parcels, visitor management, 360 capture and native applications, do not block the initial unified deployment.
