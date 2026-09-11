# ProInspect launch operations runbook

This runbook is the source-controlled operational skeleton for Development, Staging and the later separately authorised Production release. Provider credentials and personal contact details remain private.

## Provider authority

The deployment stack is Appwrite for identity/data/storage, Google Cloud for Cloud Run/builds/secrets/monitoring and Google Calendar API, Cloudflare for the edge/web runtime, and Shopify for paid service intake. Firebase/Firestore and D1/R2 are migration sources or legacy compatibility systems, not target authorities for migrated domains.

## Incident response

1. Confirm the active release SHA at Cloudflare and on every Cloud Run service before changing anything.
2. Freeze new migration/cutover writes if data integrity is in doubt.
3. Capture Appwrite project/database identity, Cloud Run revision inventory, Cloudflare deployment ID, Shopify delivery IDs and relevant correlation IDs.
4. Restore Cloud Run and Cloudflare traffic only from the recorded deployment receipts. Do not restore application data merely because code was rolled back.
5. For data incidents, preserve the current target, verify the encrypted backup and use an isolated restore rehearsal before any destructive recovery decision.
6. Record the incident, owner, severity, start/end times, customer impact, provider status and corrective action.

## Alert classes

Production-shaped Staging must prove alerts for Cloud Run errors/latency, Cloudflare failures, Appwrite availability/authorization errors, worker backlog and poison retries, failed Shopify webhooks, Google Calendar reconciliation failures, notification failures, stale backups and failed restore rehearsals.

## Release and rollback

Development must pass all applicable gates first. Staging must then install the identical source candidate, pass all gates and complete rollback/recovery rehearsal. READY_FOR_RELEASE_REVIEW is a release-review input only. Production mutation remains separately authorised and must use a fresh Production backup, a defined release window, on-call ownership and a recorded rollback window.
