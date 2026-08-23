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
- Build command: `npm run cloudflare:build`.
- Deploy command: `npx wrangler deploy`.
- Non-production deploy command: `npx wrangler versions upload`.
- Node version: the repository `.nvmrc` pins Node 22.

If a previous Cloudflare build was created from an older branch containing `package-lock.json` or `packages/migrations`, clear the Cloudflare build cache after switching the production branch. The current source tree does not contain `packages/migrations`.

## Cloudflare build variables

Configure these under Workers > Settings > Build > Variables and Secrets. These Firebase web values are deployment configuration, not privileged server credentials:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_FIRESTORE_DATABASE_ID` when using a named Firestore database
- `VITE_FIREBASE_APP_CHECK_SITE_KEY`
- `VITE_DEMO_MODE=false`

The Cloudflare build forces `VITE_API_BASE_URL=/` so browser API calls remain same-origin and are proxied by the Worker.

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

## Build failure addressed by this deployment change

The failed Cloudflare build used `npm ci` against a different/stale dependency graph and reported `@pcr/migrations@0.1.0`, which is not present in the current repository. This deployment configuration removes the stale Bun lock, pins npm as the repository package manager, adds an explicit Wrangler configuration and records the exact Cloudflare commit/branch in the build verification output. If Cloudflare still reports `@pcr/migrations`, it is building the wrong branch/commit or restoring stale build state; switch the production branch and clear the build cache before retrying.
