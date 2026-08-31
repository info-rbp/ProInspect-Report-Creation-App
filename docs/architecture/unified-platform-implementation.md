# Unified platform implementation status

## Canonical boundary

`ProInspect-Report-Creation-App` is the sole target runtime. The standalone Strata repository at commit `1a1ab340e93f72f7662ba8b8ca8b007e0e519ad9` is a migration and behavior reference only. The canonical runtime does not import Hono session authentication, D1, R2, Wrangler configuration, or the standalone application bundle.

The seven routes are portal boundaries over one React application, API, identity model, domain model and Appwrite schema. They do not create per-portal databases or services.

## Implemented foundation

- Seven guarded portal routes and a multi-portal switcher.
- Unified security roles, capabilities and agency/site/client/contractor/assignment scope targets.
- A 114-table source-controlled Appwrite schema: the reconciled 100-table foundation plus 14 approved portal extensions.
- Appwrite-backed generic operational repositories behind `APPWRITE_BACKEND_MODE=appwrite`.
- Dedicated lifecycle validation for defects, operational work orders, move bookings, access-device requests and contractor sign-out.
- Appwrite account-JWT verification and browser session helpers.
- A complete 49-table Strata D1 disposition manifest that excludes sessions/password material.
- Deterministic, side-effect-free migration planning and checksum primitives.

## Boundaries that remain distinct

- `maintenance_items` and Building Management `defects` are linkable but not merged.
- Property inspections and operational common-area inspections have separate aggregates and lifecycles.
- Property inspection reports and operational/monthly reports have separate immutable releases.
- `maintenance_plans` and `preventive_maintenance` remain separate pending an approved lossless convergence decision.

## Required completion work

The machine-readable status is `docs/migrations/strata-feature-parity.json`. It intentionally records unfinished engineering alongside the owner input that prevents Development proof. A status must not be promoted to `COMPLETE` until implementation and focused tests exist and the corresponding Development data/E2E evidence is available.

Launch-blocking work includes Appwrite browser-provider completion, dedicated transactional commands for high-value transitions, production feature screens behind the portal shell, the shared offline queue/conflict experience, Development-only migration and binary-copy runners, Shopify generic routing/replay tests, worker Appwrite adapters, authenticated seven-portal E2E, backup/restore rehearsal and real device testing.

## Migration and cutover

Migration tools remain dry-run by default and must reject the prohibited project `6a911f1e0031e90015b2`. Apply mode is authorised only for the exact `ProInspect Development` / `proinspect-development` Sydney target using approved synthetic or Development exports. No source record, object, password or session is deleted or migrated.

The Strata deployment and repository remain available for rollback. Archive is prohibited until every parity row is `COMPLETE` or explicitly `RETIRED_APPROVED`, D1/R2 reconciliation and idempotent reruns pass, all cut-over worker paths use the canonical API/Appwrite boundary, and rollback has been rehearsed.
