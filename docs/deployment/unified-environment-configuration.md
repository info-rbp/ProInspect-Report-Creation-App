# Unified platform environment configuration

Secrets must be supplied through the environment's approved secret manager. Never commit real credentials.

## Browser deployment values

These values are identifiers/endpoints exposed to the built web application:

```dotenv
VITE_AUTH_PROVIDER=appwrite
VITE_APPWRITE_ENDPOINT=https://appwrite-dev.example.com/v1
VITE_APPWRITE_PROJECT_ID=proinspect-development
VITE_API_BASE_URL=
VITE_USE_DEV_API_PROXY=false
VITE_DEMO_MODE=false
```

For Cloudflare same-origin delivery, leave `VITE_API_BASE_URL` empty so the browser uses `/api`.

During a bounded identity transition, `VITE_AUTH_PROVIDER=firebase` remains available. Do not infer provider mode from whether configuration happens to be missing.

## API deployment values

```dotenv
AUTH_PROVIDER=appwrite
APPWRITE_BACKEND_MODE=appwrite
APPWRITE_ENDPOINT=https://appwrite-dev.example.com/v1
APPWRITE_PROJECT_ID=proinspect-development
APPWRITE_PROJECT_NAME=ProInspect Development
APPWRITE_DATABASE_ID=proinspect_core
APPWRITE_API_KEY=<server-only least-privilege secret>
REQUIRE_APP_CHECK=false
```

When `AUTH_PROVIDER=appwrite`, the API accepts short-lived account JWTs and resolves authority from Appwrite agency/site membership and portal entitlement records. Appwrite user preferences are not authoritative for role or scope.

`AUTH_PROVIDER=appwrite` must not be combined with a legacy operational backend. The API rejects that configuration.

## Firebase migration fallback

Retain the current Firebase browser/API configuration only while a bounded domain or identity cutover still depends on it. Firebase App Check applies only to Firebase identity mode.

Do not expose Firebase Admin credentials to the browser.

## Cloudflare

Configure:

- Development frontend/custom hostname;
- same-origin `/api/*` proxy to the Development Google API origin;
- `CLOUDFLARE_ORIGIN_SECRET` at both the Worker and backend;
- Appwrite browser variables at build time;
- no server Appwrite API key in Worker-visible browser bindings.

## Appwrite

Configure in `ProInspect Development` only until Staging is explicitly created:

- registered Web platform for localhost and the real Development frontend hostname;
- custom Appwrite API domain under the same parent domain where available;
- SMTP provider and verified sender/domain;
- verification callback `/auth/verify-email`;
- recovery callback `/auth/reset-password`;
- privileged TOTP enrolment/recovery policy;
- seven secured Storage buckets;
- 114 source-controlled TablesDB tables after the unified extension deployment;
- backup policy and a proven restore;
- zero persistent broad API keys.

## Google Cloud workers

Retain Gemini/provider credentials with the specialist worker that requires them. Appwrite receives worker endpoints and internal service authentication, not every Google secret.

Required worker transition variables should be introduced per bounded domain, for example:

```dotenv
PROINSPECT_DATA_AUTHORITY=appwrite
PROINSPECT_API_BASE_URL=https://dev.example.com/api
INTERNAL_SERVICE_SECRET=<secret-manager reference>
```

Workers must not write a cut-over domain back to Firestore/Firebase Storage.

## Shopify

Shopify credentials remain server-only. Preserve:

```dotenv
SHOPIFY_API_VERSION=2026-07
SHOPIFY_WEBHOOK_SECRET=<secret>
INTEGRATION_TOKEN_ENCRYPTION_KEY=<secret>
INTEGRATION_TOKEN_KEY_VERSION=v1
INTEGRATION_STATE_SECRET=<secret>
```

Never use the browser to validate HMACs or call the Shopify Admin API.

## Email/SMS

Appwrite SMTP is for identity verification, recovery and invitations. Operational notification delivery remains with the approved external provider and notification worker until a measured reason justifies changing it.

## Production safety

Development scripts must reject:

- project `6a911f1e0031e90015b2`;
- non-Sydney or ambiguously named targets;
- missing explicit confirmation strings;
- server keys in `VITE_` variables;
- deployed HTTPS environments using localhost callbacks;
- Appwrite identity with the legacy operational backend;
- authority switches without a backup and rollback record.
