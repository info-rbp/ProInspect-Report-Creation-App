# ProInspect Production release runbook

## Authority model

Production is the unified ProInspect platform. The target authority stack is:

- **Appwrite**: authentication, MFA/session authority, database and file storage;
- **Google Cloud**: Cloud Run API/workers, Artifact Registry, Cloud Build, Secret Manager, Monitoring/Logging and Google Calendar API;
- **Cloudflare**: the public web/edge runtime and the only public path to the Google Cloud API;
- **Shopify**: paid service/order intake and signed webhook delivery.

The standalone Strata D1/R2 estate and older Firebase/Firestore resources are migration or explicitly retained legacy sources only. They are not allowed to become the target authority for a migrated domain.

The Appwrite project `6a911f1e0031e90015b2`, Google project `business-plan-applicatio-17047`, and root Cloudflare Worker `proinspect` are explicitly prohibited targets for the new release controller. Do not repurpose them as a shortcut.

## Release boundary

The normal `launch:*` controller supports only Development and Staging. Production is deliberately handled by the separate `launch:release` controller.

A Production release is blocked unless the exact source candidate has fresh passing Development evidence and fresh passing Staging evidence for all 19 gates, including Staging migration, device acceptance, provider integration, rollback and restore rehearsal.

The release controller also requires:

- the exact approved commit on `main`;
- dedicated Production Appwrite, Google Cloud and Cloudflare targets;
- the approved ProInspect Shopify store and API version;
- a named/datetime-bound release approval and change ticket;
- an active release window no longer than eight hours;
- named support/on-call ownership;
- legacy write freeze approval;
- final migration-delta approval;
- a one-to-seven-day rollback window;
- private Terraform, migration and backup paths outside the checkout;
- immutable Secret Manager version references;
- a fresh encrypted Production Appwrite database/file backup and isolated restore probe.

`legacyRetirementApproved` is intentionally separate from release. A successful release does not delete D1/R2/Firestore/Firebase data or archive the standalone Strata repository.

## Initial configuration

From the exact reviewed `main` commit:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run launch:audit
npm run launch:release -- init
```

This creates the private Production release configuration under Git state. It is not committed. Open the path returned by the command and populate real Production identifiers, runtime bindings and private paths.

The Production Appwrite project must use the Sydney endpoint and `proinspect_core` database, but it must not be the prohibited legacy project or Development/Staging project.

Google Cloud must use `environment=production` and enable at least Cloud Run, Artifact Registry, Cloud Build, Secret Manager, Monitoring, Logging and `calendar-json.googleapis.com`. Terraform manages these APIs.

The API runtime must use:

```text
AUTH_PROVIDER=appwrite
APPWRITE_BACKEND_MODE=appwrite
NODE_ENV=production
PUBLIC_API_BASE_URL=<Production Cloudflare origin>
WEB_APP_BASE_URL=<Production Cloudflare origin>
SHOPIFY_API_VERSION=2026-07
GOOGLE_CALENDAR_CLIENT_ID=<OAuth client ID>
GOOGLE_CALENDAR_REDIRECT_URI=<Production Cloudflare origin>/api/v1/integrations/google-calendar/oauth/callback
INTEGRATION_TOKEN_KEY_VERSION=v1
```

The API Secret Manager bindings must include immutable numeric versions for:

```text
CLOUDFLARE_ORIGIN_SECRET
SHOPIFY_WEBHOOK_SECRET
GOOGLE_CALENDAR_CLIENT_SECRET
INTEGRATION_TOKEN_ENCRYPTION_KEY
INTEGRATION_STATE_SECRET
AUTOMATION_RUNNER_SECRET
```

The release credential stage creates/rotates the per-service `APPWRITE_API_KEY` versions. Do not put any secret value in the release JSON.

## Shopify production target

The canonical shop is `proinspect-2.myshopify.com` using Admin API `2026-07`. The Production webhook URI is derived from the approved agency ID and public Cloudflare origin:

```text
https://<production-origin>/api/v1/integrations/shopify/webhooks/<agencyId>
```

The release controller additively reconciles these topics and never deletes legacy subscriptions automatically:

- `ORDERS_CREATE`
- `ORDERS_PAID`
- `ORDERS_UPDATED`
- `ORDERS_CANCELLED`
- `REFUNDS_CREATE`

Legacy subscriptions are reported for later owner-reviewed retirement. Duplicate webhook deliveries remain subject to ProInspect idempotency handling.

## Google Calendar production target

The OAuth web-client redirect URI must exactly match the Production Cloudflare callback URI above. Google Calendar access remains server-side. The release package verifies the Calendar API is enabled; live Staging acceptance must already have proved OAuth, event create/reschedule/cancel, timezone handling, watch renewal and reconciliation before Production is permitted.

## Production preflight

Run read-only Production provider checks before the change window:

```bash
npm run launch:release -- preflight
```

Preflight revalidates fresh Development/Staging evidence and checks Appwrite project identity, Google Cloud project/APIs, an existing rollback-capable Cloudflare Worker deployment, Shopify identity/subscription inventory, the exact repository candidate and toolchain.

Production Cloudflare must already have one settled active version before the release. The release process will not begin from a split/ambiguous deployment.

## Production stage order

Apply exactly one stage at a time. There is no `--stage all` Production shortcut.

```text
terraform
credentials
backup
schema
data
files
google
cloudflare
shopify
verify
```

Each stage prints/requires an exact confirmation of the form:

```text
RELEASE:<stage>:<production-appwrite-project-id>:<approved-commit>
```

Example structure:

```bash
npm run launch:release -- apply --stage terraform \
  --confirm RELEASE:terraform:<production-appwrite-id>:<full-commit-sha>
```

Terraform still uses the launch package's reviewed plan-digest mechanism. The first Terraform attempt writes the private plan review and stops. Review it, export the exact `LAUNCH_TERRAFORM_PLAN_SHA256` digest, then rerun the same release stage.

The credential stage may change only private release metadata by recording Appwrite key IDs and immutable Secret Manager versions. The next required stage is therefore a fresh Production backup using that exact post-credential configuration.

## Cloudflare candidate promotion

Cloudflare no longer uses a blind `wrangler deploy` for an existing release.

The release path:

1. uploads the exact candidate as a Worker Version with an immutable release tag;
2. creates a deployment containing the existing version at 100% and the candidate at 0%;
3. sends smoke requests with `Cloudflare-Workers-Version-Overrides` pinned to the candidate version;
4. verifies the candidate Worker version ID/tag, source commit, backend commit, seven portal shells, security headers and anonymous API denial;
5. promotes the candidate to 100% only after those checks pass;
6. records the previous deployment for exact rollback.

A Production release requires an existing Worker/deployment. Development or Staging may bootstrap a new isolated Worker, but Production will not silently bootstrap one during the release window.

## Backup, migration and recovery

Before schema/data/file mutation, the release controller creates an AES-256-GCM encrypted Appwrite database/file backup outside the repository, performs consistency reads, restores into isolated probe resources, verifies checksums and permissions, and removes the probe resources.

The backup must be less than one hour old for subsequent mutation and match the exact release configuration hash.

Migration uses the approved SHA-256-pinned bundle and never overwrites conflicting targets. Interrupted writes are reconciled using the migration journal. Source records/files are never deleted by the installer. Database rollback remains a separately reviewed recovery operation because reverting code traffic and reverting business data are not equivalent acts.

## Google Cloud release

The six Production Cloud Run targets are:

```text
api
pdf-worker
notification-worker
dashboard-worker
document-worker
integration-worker
```

All images are built from the exact release commit. New revisions are created with no traffic and all six must become Ready before traffic begins switching. If the traffic phase fails, the deployment code attempts to restore services already switched to their recorded prior traffic configuration.

Every service must run with Appwrite authority. The final verification checks the release SHA plus `AUTH_PROVIDER=appwrite` and `APPWRITE_BACKEND_MODE=appwrite`.

## Final verification

Run the final `verify` release stage only after Shopify reconciliation succeeds. Its successful state is:

```text
PRODUCTION_PROMOTED_AWAITING_OBSERVATION
```

That wording is deliberate. Deployment is not the same thing as proving there was no latent operational problem five minutes later.

Keep the declared support owner active for the rollback window and observe Cloud Run, Cloudflare, Appwrite, worker queues/retries, Shopify deliveries, Google Calendar reconciliation, notification delivery and backup/restore telemetry.

## Traffic rollback

The controller supports explicit traffic rollback for Cloudflare and Google Cloud:

```text
ROLLBACK:cloudflare:<production-appwrite-id>:<release-commit>
ROLLBACK:google:<production-appwrite-id>:<release-commit>
```

Run only from the exact release candidate and after confirming the recorded deployment state. The rollback restores recorded traffic/revisions and does not alter Appwrite data.

Data rollback is intentionally not automatic. Use the migration journal, immutable source snapshot, reconciliation report and encrypted backup to make a separately approved data-recovery decision.

## Legacy retirement

Do not retire the standalone Strata runtime, D1/R2, Firebase/Firestore compatibility data, prior workers/webhooks or rollback credentials merely because the release completed.

Retirement requires an observation period, reconciliation sign-off, no unresolved queue/webhook discrepancies, confirmed Production backups, and explicit owner approval. Until then legacy systems remain read-only or otherwise isolated according to the cutover plan.
