# Cloudflare Worker deployment

## Architecture

Cloudflare is the public application edge and SPA host. The existing Google backend remains authoritative for Firebase Admin, Identity Platform/App Check verification, Firestore, Cloud Storage signing, Gemini, document/PDF work and background workers.

```text
Browser
  -> Cloudflare Worker
       -> static React assets from Workers Assets
       -> /api/*, /v1/* and /health -> Google API origin (Cloud Run)
```

Do not place a Google service-account private key in the Worker. The current backend is deliberately kept on Google infrastructure so it can continue using Google-managed workload identity/Application Default Credentials.

## Cloudflare project settings

The Cloudflare Worker name must be `proinspect` because Workers Builds requires the dashboard project name to match `wrangler.jsonc`.

Use these build settings:

- Production branch: `main` after the deployment PR is merged.
- Root directory: repository root.
- Build command: `npm run cloudflare:ci`.
- Deploy command: `npm run cloudflare:deploy`.
- Non-production deploy command: `npm run cloudflare:preview`.
- Node version: the repository `.nvmrc` pins Node 22.

`SKIP_DEPENDENCY_INSTALL=1` is recommended because Workers Builds may otherwise perform an automatic dependency install before the repository-controlled install. The build verifier treats a missing skip flag as a warning rather than a deployment blocker. This keeps preview builds functional even when Cloudflare applies trigger-specific build variables inconsistently.

If a previous Cloudflare build was created from an older branch containing `package-lock.json` or `packages/migrations`, clear the Cloudflare build cache after switching the production branch. The current source tree does not contain `packages/migrations`.

## Firebase web configuration

Cloudflare production uses `firebase-cloudflare-config.json` as the public Firebase web configuration fallback. Environment variables still override the checked-in values when supplied. This file contains browser configuration only, not privileged Google credentials.

The checked-in production Firebase configuration includes:

- project ID `business-plan-applicatio-17047`
- the supplied Firebase Web App ID
- Firebase web API key
- authentication domain
- storage bucket
- messaging sender ID
- analytics measurement ID
- the existing named Firestore database ID used by this application

Optional build-time overrides can still be configured under Workers > Settings > Build > Variables and Secrets:

- `SKIP_DEPENDENCY_INSTALL=1` (recommended)
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_FIRESTORE_DATABASE_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FIREBASE_APP_CHECK_SITE_KEY`
- `VITE_DEMO_MODE=false`

The six core Firebase build variables are no longer required for Cloudflare to compile the application because the repository fallback is complete. `VITE_FIREBASE_APP_CHECK_SITE_KEY` is intentionally not embedded because no App Check/reCAPTCHA Enterprise site key has been supplied. When the Google API uses `REQUIRE_APP_CHECK=true`, configure that site key before production acceptance.

The Cloudflare build forces `VITE_API_BASE_URL=/` so browser API calls remain same-origin and are proxied by the Worker.

The repository pins npm 10.9.2 and Wrangler 4.120.0. Do not replace the build command with `npm ci` unless and until a newly generated, reviewed `package-lock.json` for the current complete workspace graph is committed.

## Cloudflare runtime configuration

Configure under Workers > Settings > Variables & Secrets:

- Plaintext variable: `GOOGLE_API_ORIGIN=https://<your-google-api-host>`
- Secret: `CLOUDFLARE_ORIGIN_SECRET=<high-entropy-random-value>`

Create the edge secret once, for example with `openssl rand -base64 32`, and store the same value in the Google backend environment/Secret Manager as `CLOUDFLARE_ORIGIN_SECRET`. Never commit the value.

The Worker removes any client-supplied ProInspect edge headers, injects the shared origin secret, and forwards the Cloudflare client IP in `x-proinspect-client-ip`. When the Google backend has `CLOUDFLARE_ORIGIN_SECRET` configured, all routes except `GET /health` reject direct requests that do not carry the Worker secret. The backend only trusts the forwarded client IP after the secret is verified with a timing-safe comparison, preserving per-client rate limiting and audit source addresses behind Cloudflare.

`wrangler.jsonc` uses `keep_vars=true` so dashboard-managed runtime configuration is retained during deploys. Secrets remain managed in Cloudflare and must not be committed to source control.

For local `wrangler dev`, copy `.dev.vars.example` to `.dev.vars` and replace the example secret.

## Google configuration that remains server-side

Keep the following on the Google backend rather than moving them into the Cloudflare Worker:

- `GEMINI_API_KEY`
- `UPLOAD_BUCKET`
- `REQUIRE_APP_CHECK=true`
- `CLOUDFLARE_ORIGIN_SECRET` (same value as the Cloudflare Worker secret)
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- notification provider credentials
- integration encryption/state secrets
- e-sign/provider credentials
- Firebase Admin/Google workload identity

The normal Firebase web API key is not a server credential. Security must continue to rely on Identity Platform/Firebase Auth, Firestore rules/IAM, App Check and backend authorisation.

## Google console changes for the Cloudflare domain

Before production acceptance:

1. Add the final Cloudflare custom domain to Firebase Authentication authorised domains.
2. Add the domain to the reCAPTCHA Enterprise/App Check web-key allow-list.
3. Update Google OAuth redirect URIs, including Google Calendar integration, to the Cloudflare public origin where applicable.
4. Configure Cloud Run/API CORS conservatively even though browser calls are same-origin through Cloudflare.
5. Set `CLOUDFLARE_ORIGIN_SECRET` on the API before treating Cloudflare as the enforced public boundary.
6. Keep direct Google backend URLs out of browser configuration; the Worker is the public API facade.

## Validation

After deployment:

1. `GET /health` through the Cloudflare domain must return the Google API health response.
2. Sign in through Firebase/Identity Platform and confirm an authenticated API request succeeds.
3. Run the existing API smoke suite against the Cloudflare origin.
4. Confirm `/api/v1/inspection-route-plans` does not return `Route not found`.
5. Confirm an unknown SPA route returns the React application shell, not a Cloudflare 404.
6. Confirm a direct request to the Google API for a protected route returns `403 EDGE_REQUIRED` after origin protection is enabled.
7. Confirm Workers Logs record proxy status without logging authorization headers, origin secrets or tokens.

## Build failure handling

The Cloudflare build verifier distinguishes hard configuration failures from build-environment quirks. A generated `bun.lock` inside Workers CI or a missing `SKIP_DEPENDENCY_INSTALL` value produces a warning, not a failure. Missing Firebase environment variables also no longer fail the build when `firebase-cloudflare-config.json` is complete.

If Cloudflare again reports `@pcr/migrations`, it is building the wrong repository/branch or restoring stale source state. The `ProInspect-Report-Creation-App` Cloudflare branch does not contain that workspace.
