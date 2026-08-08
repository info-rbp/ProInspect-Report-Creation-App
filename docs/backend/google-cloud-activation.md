# Phase 5 Google Cloud activation

The repository implementation is complete only after CI passes. The controls below require applied Google Cloud projects, environment-specific URLs and IAM principals, so they remain deployment placeholders rather than fabricated completion claims.

## Required values

| Value | Purpose | Repository placeholder |
| --- | --- | --- |
| Cloud Run API URL | Frontend API origin | `VITE_API_BASE_URL` |
| Upload bucket name | Signed upload destinations | `UPLOAD_BUCKET` |
| App Check site key | Browser App Check token creation | `VITE_FIREBASE_APP_CHECK_SITE_KEY` |
| App Check enforcement | Reject unverified clients | `REQUIRE_APP_CHECK=true` |
| API image digest | Immutable Cloud Run release | Build `apps/api/Dockerfile` |

## Development activation

- [ ] Build the API image in the development Artifact Registry repository.
- [ ] Deploy the immutable image digest to the development `api` Cloud Run service.
- [ ] Set `UPLOAD_BUCKET` to the development upload bucket.
- [ ] Set `REQUIRE_APP_CHECK=true` after the development web app is registered.
- [ ] Set `VITE_API_BASE_URL` and `VITE_FIREBASE_APP_CHECK_SITE_KEY` in the development web build.
- [ ] Grant the API service account Firestore access already declared by the landing zone.
- [ ] Grant only the signing permission required for V4 upload URLs. Do not create a service-account key.
- [ ] Confirm Cloud Run rejects unauthenticated invocation unless an approved external HTTPS boundary is deliberately used.
- [ ] Exercise create, retry, conflicting retry and stale-version cases against development.
- [ ] Verify one material audit event per committed action and one authorisation event per decision.

## Asynchronous delivery placeholder

Phase 5 writes analysis, PDF and notification tasks to the Firestore task outbox. Before production:

- [ ] Deploy an outbox dispatcher or replace the adapter with direct Cloud Tasks creation.
- [ ] Configure separate authenticated Cloud Tasks queues for analysis, PDF and notifications.
- [ ] Use OIDC service-account invocation for worker targets.
- [ ] Record task delivery attempts and terminal failure status.
- [ ] Preserve the API idempotency key when dispatching downstream work.
- [ ] Verify duplicate Cloud Tasks deliveries do not duplicate AI runs, PDFs or messages.

The outbox prevents a database record from claiming a task was dispatched when the queue call failed. A dispatcher is still required to move pending outbox records to Cloud Tasks.

## Staging and production gates

- [ ] Repeat the development checks in staging with staging identities and buckets.
- [ ] Export and archive the generated OpenAPI document for the promoted release.
- [ ] Put the public API behind the approved HTTPS load balancer or API gateway if external clients require access.
- [ ] Configure edge rate limits and request-size limits.
- [ ] Configure CORS to the exact deployed web origins.
- [ ] Enable Cloud Armor rules where the chosen ingress architecture supports them.
- [ ] Add alerting for API 5xx responses, idempotency conflicts, outbox backlog and dead-letter tasks.
- [ ] Require production promotion approval through the existing Cloud Deploy and GitHub environment controls.
- [ ] Capture evidence links in issue #5 before closing it.

## Evidence required for issue closure

1. Development and staging Cloud Run revision URLs and image digests.
2. Successful authenticated API smoke tests.
3. Successful App Check rejection test.
4. Idempotency replay and conflict test output.
5. Stale optimistic-version rejection output.
6. Audit event samples for a material action and denied action.
7. Upload-session signed URL test without a service-account key.
8. Outbox or Cloud Tasks duplicate-delivery test.
9. Generated OpenAPI document from the deployed revision.
