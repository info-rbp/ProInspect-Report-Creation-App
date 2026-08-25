# ProInspect production activation and release runbook

## Release gate and architecture

Production traffic is `browser -> Cloudflare Worker/assets -> Cloud Run API -> named Firestore, Cloud Storage and Pub/Sub workers`. Cloudflare is the only public API edge. The API verifies the shared edge secret before protected-route identity, membership, agency and capability checks. Firestore rules remain deny-by-default for browser writes.

Do not merge or deploy until the repository CI validation and browser jobs are green, the secret scan is clean, and the pull-request diff has been reviewed. A local or Cloud Build pass is useful evidence but does not replace a required GitHub status. Deploy only an immutable commit from `main`.

The application excludes trust accounting, payment processing, rent collection and all other money handling.

## Identity Platform and TOTP MFA

Production has no public registration UI. Identity Platform must also enforce this at the service boundary: anonymous sign-in disabled and `client.permissions.disabledUserSignup=true`. Users are created only through audited invitation or administrator provisioning. Do not grant a default agency membership.

Privileged roles are `super_admin`, `proinspect_admin` and `reviewer`. They require Firebase TOTP MFA. Only the signed `firebase.sign_in_second_factor` ID-token field is accepted as MFA evidence. A restored privileged session without that field is signed out and must complete a fresh MFA sign-in.

From Google Cloud Shell, in a reviewed checkout:

```bash
export GOOGLE_CLOUD_PROJECT=business-plan-applicatio-17047
export FIREBASE_PROJECT_ID=business-plan-applicatio-17047
gcloud config set project "$GOOGLE_CLOUD_PROJECT"
gcloud auth application-default login
npm ci --ignore-scripts --no-audit --no-fund
node scripts/enable-totp-mfa.mjs
```

The script reads current project configuration, preserves unrelated factors/settings, accepts adjacent interval values from 0 through 10, and makes no update if TOTP is already correctly enabled. It never prints credentials or TOTP secrets.

Verify service-side sign-up controls without printing access tokens:

```bash
PROJECT_ID=business-plan-applicatio-17047
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config"
```

The returned configuration must show TOTP enabled, anonymous sign-in disabled and user sign-up disabled. Terraform declares the same controls in `google_identity_platform_config.this`.

Add the Cloudflare production host `proinspect-property-inspection-platform.delicate-dream-e4c9.workers.dev` and every final custom domain to Firebase Authentication authorised domains. For Google sign-in, register the Cloudflare/custom origin and the Firebase handler URI `https://business-plan-applicatio-17047.firebaseapp.com/__/auth/handler` in the OAuth client. If `authDomain` changes to a custom domain, register its `/__/auth/handler` URI as well.

## App Check activation

`VITE_FIREBASE_APP_CHECK_SITE_KEY` is intentionally external configuration. Do not commit a site key placeholder and do not set `REQUIRE_APP_CHECK=true` before acceptance succeeds.

Owner activation sequence:

1. Create or reuse a reCAPTCHA Enterprise score key whose web allow-list contains the Workers host and final custom domains.
2. Register that key against the production Firebase web app in App Check.
3. Supply the public key as `VITE_FIREBASE_APP_CHECK_SITE_KEY` to the Cloudflare build; keep `app_check_enforcement_mode=UNENFORCED` and `REQUIRE_APP_CHECK=false` while observing metrics.
4. Validate sign-in, authenticated API acceptance, missing/invalid App Check rejection in a staging-enforced environment, Firestore and Storage access, MFA enrolment and MFA challenge.
5. Set Terraform `app_check_enforcement_mode="ENFORCED"` and `require_api_app_check=true`, apply them together, and re-run the production smoke suite immediately. Terraform rejects API enforcement when no site key is configured.

No App Check debug token may be used in production.

## Named Firestore

Production uses only:

```text
ai-studio-propertyconditio-8ed7569c-35bc-4e82-ac6c-2b34380b5b60
```

Set `FIRESTORE_DATABASE_ID` on the API, PDF, notification, dashboard, document and integration Cloud Run services, and on every migration/provisioning process. Those processes fail during production startup when it is missing. The AI worker does not access Firestore. The browser already uses the same ID through Firebase configuration.

Terraform now declares the named database instead of `(default)`. Before the first apply against an existing project, import the existing database into the module address and inspect the plan; never allow Terraform to create, replace or delete a production database:

```bash
cd infrastructure/terraform/environments/production
terraform init -backend-config='<approved backend configuration>'
terraform import \
  'module.environment.google_firestore_database.default' \
  'projects/business-plan-applicatio-17047/databases/ai-studio-propertyconditio-8ed7569c-35bc-4e82-ac6c-2b34380b5b60'
terraform plan -out=production.tfplan
terraform show production.tfplan
```

Stop if the plan proposes replacing or deleting Firestore, a service account, a secret, a bucket or a production Cloud Run service.

## Dedicated API service account and IAM

The final API runtime identity is:

```text
proinspect-api@business-plan-applicatio-17047.iam.gserviceaccount.com
```

Its minimum access, based on current API calls, is:

- project `roles/datastore.user`;
- project `roles/pubsub.publisher`;
- `roles/storage.objectAdmin` on the upload and report buckets (the API creates, reads and deletes governed objects);
- `roles/secretmanager.secretAccessor` only on `cloudflare-origin-secret` and `email-provider-config`;
- `roles/iam.serviceAccountTokenCreator` on itself for V4 signed URLs.

The API does not directly enqueue Cloud Tasks and does not require `roles/cloudtasks.enqueuer`. It must not receive Owner or Editor.

Add or verify the dedicated account's unconditional bindings with:

```bash
PROJECT_ID=business-plan-applicatio-17047
API_SA="proinspect-api@$PROJECT_ID.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$API_SA" --project="$PROJECT_ID"
for ROLE in roles/datastore.user roles/pubsub.publisher; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$API_SA" --role="$ROLE" --condition=None
done
for BUCKET in "$PROJECT_ID-uploads" "$PROJECT_ID-reports"; do
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member="serviceAccount:$API_SA" --role=roles/storage.objectAdmin
done
for SECRET in cloudflare-origin-secret email-provider-config; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT_ID" \
    --member="serviceAccount:$API_SA" --role=roles/secretmanager.secretAccessor
done
gcloud iam service-accounts add-iam-policy-binding "$API_SA" \
  --project="$PROJECT_ID" --member="serviceAccount:$API_SA" \
  --role=roles/iam.serviceAccountTokenCreator
```

First list the current conditional bindings and save the result as restricted release evidence:

```bash
gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:$API_SA" \
  --format='table(bindings.role,bindings.condition.title,bindings.condition.expression)'
```

If an expired conditional binding exists, add the unconditional binding above first. Remove the old conditional binding only by copying its exact title/expression into a separately reviewed `gcloud projects remove-iam-policy-binding ... --condition=...` command. After validation, switch the service:

```bash
gcloud run services update api --project="$PROJECT_ID" \
  --region=australia-southeast1 --service-account="$API_SA"
```

Confirm health, signed uploads, report/archive operations, notification callbacks and Pub/Sub dispatch before removing any role from the temporary broad runtime account. Terraform declares `proinspect-api`; if an older Terraform state contains `api@...`, import/move the existing dedicated account only after reviewing `terraform plan`.

For the known existing production account and edge secret, first back up remote state, then reconcile their addresses before applying:

```bash
cd infrastructure/terraform/environments/production
terraform state pull > "terraform-state-before-proinspect-api-$(date +%Y%m%d%H%M%S).json"
terraform state show 'module.environment.google_service_account.runtime["api"]'
terraform state show 'module.environment.google_secret_manager_secret.runtime["cloudflare-origin-secret"]' || true
```

If the API address still records `api@...`, remove only that state address (this does not delete the cloud account) and import the existing dedicated account. If the edge secret is absent from state, import it too:

```bash
terraform state rm 'module.environment.google_service_account.runtime["api"]'
terraform import 'module.environment.google_service_account.runtime["api"]' \
  'projects/business-plan-applicatio-17047/serviceAccounts/proinspect-api@business-plan-applicatio-17047.iam.gserviceaccount.com'
terraform import 'module.environment.google_secret_manager_secret.runtime["cloudflare-origin-secret"]' \
  'projects/business-plan-applicatio-17047/secrets/cloudflare-origin-secret'
terraform plan -out=production.tfplan
terraform show production.tfplan
```

Do not run `terraform state rm` when the address already records `proinspect-api`, and do not apply a plan that deletes the former account or changes secret versions as a side effect. The old broad runtime identity is retired separately only after the dedicated identity passes production smoke checks.

## Runtime configuration

API requirements:

```text
NODE_ENV=production
GOOGLE_CLOUD_PROJECT=business-plan-applicatio-17047
FIREBASE_PROJECT_ID=business-plan-applicatio-17047
FIRESTORE_DATABASE_ID=ai-studio-propertyconditio-8ed7569c-35bc-4e82-ac6c-2b34380b5b60
PROINSPECT_PROVIDER_ID=proinspect
APP_VERSION=<full main commit SHA>
CLOUDFLARE_ORIGIN_SECRET=<Secret Manager reference>
REQUIRE_APP_CHECK=false until acceptance, then true
```

Cloudflare runtime requires `GOOGLE_API_ORIGIN` and secret `CLOUDFLARE_ORIGIN_SECRET`. The two platforms must use the same secret. Never print it. Cloudflare builds require the public Firebase configuration and, after activation, `VITE_FIREBASE_APP_CHECK_SITE_KEY`.

## Post-merge release

Run only after PR #53 is merged and required CI is green:

```bash
git checkout main
git pull --ff-only origin main
MAIN_SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
bash scripts/google-cloud-release.sh business-plan-applicatio-17047 "$MAIN_SHA" australia-southeast1
npm ci --ignore-scripts --no-audit --no-fund
npm run cloudflare:ci
npm run cloudflare:deploy
```

The Cloud Build release updates `APP_VERSION` for the API. Verify both paths report the expected commit:

```bash
gcloud run services describe api --project=business-plan-applicatio-17047 \
  --region=australia-southeast1 --format='value(status.latestReadyRevisionName)'
curl --fail-with-body --silent --show-error "$GOOGLE_API_ORIGIN/health"
curl --fail-with-body --silent --show-error \
  'https://proinspect-property-inspection-platform.delicate-dream-e4c9.workers.dev/health'
```

## Production smoke checks

Use an interactive login or environment-provided short-lived ID/App Check tokens. Never place a password in a command, script, history or repository.

- Cloud Run and Cloudflare `/health` return 200 and the expected `APP_VERSION`.
- A direct protected Cloud Run request returns `403 EDGE_REQUIRED`.
- A Cloudflare-proxied authenticated request succeeds.
- The provisioned provider administrator signs in without `MEMBERSHIP_INACTIVE`.
- First privileged use enrols TOTP; the next login requires a TOTP challenge.
- A wrong/expired code is rejected and retry remains available.
- Dashboard, Properties, Inspection Jobs, Reports and Maintenance load after MFA.
- User/admin routes follow the server membership role.
- A cross-agency request fails; only a signed provider super administrator with explicit provider membership can select another agency.
- An inspector never receives cached admin dashboard data after a downgrade.
- Logout clears the session; restoring a password-only privileged session cannot bypass MFA.

## Rollback

Record the previous Cloud Run revision and Cloudflare deployment/version before release. If acceptance fails:

```bash
gcloud run revisions list --service=api --project=business-plan-applicatio-17047 \
  --region=australia-southeast1
gcloud run services update-traffic api --project=business-plan-applicatio-17047 \
  --region=australia-southeast1 --to-revisions='<previous-revision>=100'
npx wrangler deployments list
npx wrangler rollback '<previous-deployment-id>'
```

Rollback application images/traffic first. Do not roll back membership enforcement, MFA policy, edge protection, named Firestore selection, rules or IAM safeguards. If a data migration ran, follow its documented reconciliation/rollback plan rather than deleting production data.

## Current activation blockers

At the time this runbook was written, the known production API revision was `api-00004-62r`, containing an earlier branch state. The repository MFA/frontend and complete named-Firestore worker changes are not proven deployed. Identity Platform TOTP, App Check/reCAPTCHA, authorised domains/OAuth, dedicated-account IAM, Firebase password rotation, GitHub CI and final production smoke evidence must be confirmed externally before declaring production ready.

The direct `xlsx` dependency was removed because its high-severity advisories have no npm fix; client and price-book imports now use a current XLSX reader plus a bounded CSV parser and reject legacy XLS input. `npm audit --omit=dev --audit-level=high` is a release gate. A remaining moderate `uuid` advisory is transitive through Firebase Admin's optional Google Storage 7.x dependency. The affected v3/v5/v6 buffer APIs are not called by ProInspect or the `teeny-request` path, which uses UUID v4. Do not force npm's suggested Firebase Admin downgrade; monitor Firebase Admin/Google Storage for a compatible upstream resolution.
