# Cloud Run API

## Boundary

The browser authenticates with Identity Platform and sends its Firebase ID token, App Check token and agency identifier to the Cloud Run API. Firestore Admin access, workflow changes, audit creation, upload signing and asynchronous task creation occur only in the backend.

Local-only development may continue to use IndexedDB. A configured Firebase deployment uses `/api/v1`; it does not fall back to direct operational Firestore writes.

## Versioned routes

The route catalogue generates the OpenAPI document served at `/api/v1/openapi.json`.

- `/api/v1/agencies`
- `/api/v1/users`
- `/api/v1/invitations`
- `/api/v1/clients`
- `/api/v1/properties`
- `/api/v1/tenancies`
- `/api/v1/inspection-jobs`
- `/api/v1/reports`
- `/api/v1/templates`
- `/api/v1/report-versions`
- `/api/v1/uploads`
- `/api/v1/analysis-jobs`
- `/api/v1/pdf-jobs`
- `/api/v1/tenant-responses`
- `/api/v1/notifications`
- `/api/v1/audit-history`

Inspection-job and report transitions use `POST /api/v1/{resource}/{id}/transitions` with `expectedVersion`.

## Request contract

Protected requests require:

- `Authorization: Bearer <Firebase ID token>`
- `X-Firebase-AppCheck: <App Check token>` when enforcement is enabled
- `X-Agency-Id: <agency ID>`
- `Idempotency-Key: <unique key>` for every material write

Updates require `expectedVersion`. A stale version returns `409 VERSION_CONFLICT`.

## Idempotency

The backend stores one record per agency, operation and idempotency key. A retry with the same body replays the original status and response and sets `Idempotency-Replayed: true`. Reusing a key with a different body returns `409 IDEMPOTENCY_CONFLICT`.

The ledger covers resource creation and updates, workflow transitions, upload sessions, analysis jobs, PDF jobs, tenant submissions and notification jobs.

## Errors

Errors use one envelope:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "The record has changed. Reload and retry.",
    "status": 409,
    "correlationId": "...",
    "details": {}
  }
}
```

The correlation ID is also returned in `X-Correlation-Id`.

## Audit

Authorisation decisions and completed material actions are separate append-only events. A successful permission check does not pretend that a later database mutation succeeded. Material audit events are appended only after the mutation or task record is committed.

## Shared validation

`@pcr/validation` is the authoritative schema package for frontend commands, API bodies, AI worker inputs and future import or migration tools. Server-managed fields such as timestamps and actors are rejected from client commands.

## Container

Build from the repository root so workspace packages are available:

```bash
docker build -f apps/api/Dockerfile -t pcr-api .
```

The container listens on port `8080` and runs as the unprivileged Node user.
