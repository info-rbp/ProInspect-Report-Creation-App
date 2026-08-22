# Production readiness closeout

This document is the release gate for the repository changes that make agency settings authoritative, complete report-presentation administration, operationalise governed communications, and automate dashboard history.

## Repository validation

A release candidate must pass the exact-head pull-request gates before merge:

- shared package builds;
- web, API, AI worker, PDF worker, notification worker and dashboard worker type checks;
- formatting and lint;
- unit and Firestore/Storage rules tests;
- application builds and built-artifact verification;
- Firebase emulator integration tests;
- Chromium browser end-to-end tests;
- Terraform formatting and validation for bootstrap, development, staging, production and delivery roots;
- combined `ci/full-validation` status on the exact merge candidate SHA.

Do not merge around a repository validation failure. An infrastructure-level GitHub Actions failure where no workflow step is allocated must be distinguished from a test failure and rerun without changing application code.

## Deployment order

1. Apply the reviewed Terraform plan to development.
2. Deploy the API, notification worker, dashboard worker and PDF worker images built from the same source revision.
3. Validate Firebase/Identity Platform security controls in development.
4. Configure test agency settings, communication providers, branding and report layouts.
5. Run the acceptance scenarios below.
6. Promote the same release through staging.
7. Capture release evidence.
8. Promote to production only after the protected production approval gate.

## People & Access activation

People & Access remains disabled for production administration until all controls in `docs/security/people-access-activation.md` are evidenced. In particular:

- Identity Platform is enabled and public self-sign-up is disabled;
- agency tenancy boundaries are configured;
- MFA is enforced for privileged roles;
- password policy and email-enumeration protection are enabled;
- Firebase App Check is enforced outside tests;
- deny-by-default Firestore rules are deployed;
- membership and invitation mutation is server-authoritative;
- refresh-token revocation is verified for suspension and role changes;
- invitation delivery is verified through the configured communication provider;
- cross-agency, privilege-escalation, last-admin, self-deactivation and invitation-expiry tests pass.

## Authoritative Settings acceptance

For a staging agency, save non-default values and prove each downstream workflow uses the saved version:

- inspection duration, booking buffers, payment/access/review gates and default template;
- automatic inspector assignment strategy and resulting assignment-policy snapshot;
- maintenance response SLA and resulting `slaDueAt`;
- delegated, landlord and emergency maintenance approval thresholds;
- SendGrid/Twilio connection, sender identity and credential rotation;
- communication quiet hours, delay, retries and escalation targets.

New inspection and maintenance records must retain the Settings version/policy snapshot used to create them so later configuration changes do not rewrite historic operational decisions.

## Communication acceptance

Use non-production provider accounts and recipients.

- Send one direct email and SMS notification.
- Verify agency-specific encrypted provider credentials are resolved by the notification worker.
- Trigger an inspection reminder and verify a real notification job is materialised before delivery.
- Verify template variables are substituted only from the allowed variable set.
- Verify quiet-hours delivery is deferred and later drained by the hourly scheduler.
- Force a transient provider failure and verify retry/backoff.
- Exhaust retries and verify an escalation record is produced where configured.
- Verify SendGrid/Twilio callbacks update communication delivery state.
- Confirm credentials never appear in API responses, logs or browser storage.

## Report presentation acceptance

Create a draft Report Layout, modify section order and page policy, publish it and then finalise a report.

The report must contain immutable presentation provenance before the PDF render begins:

- presentation template ID and version;
- complete presentation template snapshot;
- branding profile ID and version;
- complete branding snapshot;
- branding SHA-256;
- renderer version;
- font-bundle version.

Then verify:

- published and retired layout versions cannot be edited;
- a new draft can be cloned from a historic layout;
- a branding change affects only subsequently finalised reports;
- an existing final report reproduces from its pinned presentation identity;
- final PDF/archive manifests contain the same presentation identity as the report.

## Branding asset acceptance

- Upload PNG, JPEG, WebP and SVG samples below 5 MB.
- Verify an incorrect declared SHA-256 is rejected and the object is removed.
- Verify the completed asset stores exact object generation, file size and SHA-256.
- Select an approved logo asset and save the active branding profile.
- Confirm branding assets are agency-scoped and inaccessible across agencies.

## Dashboard history acceptance

The `dashboard-worker` is scheduled for 23:55 Australia/Perth and writes one deterministic daily record per agency using Firestore count aggregations.

Verify:

- only one `dashboard-YYYY-MM-DD` record exists per agency/day;
- rerunning the scheduled task updates that daily record rather than creating duplicates;
- scheduled snapshots are produced without a browser session or administrator action;
- snapshot queries use server-side aggregate counts rather than downloading full collections;
- historical dashboard views use snapshot history for trends while live operational queues remain current-state API reads.

## Production evidence pack

Retain the following with the release record:

- exact Git commit and merged pull request;
- CI and Terraform validation run URLs;
- Terraform plan/apply evidence for each promoted environment;
- deployed Cloud Run revisions for API and workers;
- Firebase/Identity Platform and App Check evidence;
- communication-provider staging delivery evidence;
- report-layout and branding reproducibility evidence;
- dashboard scheduled-snapshot evidence;
- any approved exceptions with owner and expiry date.

## Deliberate remaining renderer gates

Two report-rendering upgrades require separately approved assets/tooling and must not be faked during this closeout:

1. **Embedded full-Unicode typography.** The current deterministic renderer identifies the standard PDF font bundle as `standard14-v1`. A licensed/open-source font bundle must be selected, vendored through the approved build process and assigned a new immutable font-bundle version before full-Unicode support can be claimed.
2. **Raster/pixel visual regression.** Structural/document-model and PDF validity tests exist. Pixel regression must use a pinned rasteriser version and reviewed golden fixtures for Entry, Routine, Exit, Comparison and Maintenance reports before it becomes a required CI gate.

These two items change renderer identity and therefore require intentional versioning rather than an opportunistic library upgrade.
