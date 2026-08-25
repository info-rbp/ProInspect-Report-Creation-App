# Functional QA operational-readiness remediation

This change set addresses the live exploratory QA findings recorded on 25 August 2026 against the canonical ProInspect Cloudflare application. The purpose is to make the existing operational surface coherent and testable before broadening production use. It does not add trust accounting, rent collection, payment processing or any other money-handling capability.

## Release blockers addressed

### Property onboarding

Cloud property creation is now server-authoritative and fail-closed. The browser no longer sends the onboarding draft identifier as the persistent property ID and no longer converts a failed cloud write into a browser-local success. A successful create is immediately re-read by its generated ID before the onboarding flow navigates away. Asset, access-device and alert additions now provide validation feedback instead of silently ignoring empty submissions.

### Report register routing

Report-index data is normalized at the service boundary so the authoritative report resource `id` is always exposed as the stable `reportId` used by register links. A regression test covers authoritative, legacy and missing-ID shapes.

### Mobile application shell

The desktop sidebar becomes an off-canvas navigation drawer on smaller viewports, with backdrop dismissal, close-on-navigation, Escape handling, scroll locking, an accessible toggle and responsive top-bar content.

## Major operational defects addressed

- Route-plan creation now opens a validated dialog and persists only after an inspector, date and plan name are selected. Active inspection jobs can be selected as route stops, duplicate active inspector/date plans are rejected, and empty plans cannot be published.
- Missing report assessment values are represented as `unassessed`, not `unable_to_confirm`. Only explicit exception states contribute to exception totals.
- Canonical catalogue reads are bounded and surface actionable timeout/retry feedback rather than remaining indefinitely in a loading state.
- Inspection-job details stop blocking the whole page on secondary audit/workflow requests. Core job/property data renders first; ancillary failures are reported independently.
- API requests have a bounded timeout and actionable `REQUEST_TIMEOUT` failure instead of indefinite browser waits.

## Previously scaffolded modules upgraded

### Communications

The module now provides a searchable conversation register, explicit conversation creation, participants, optional property/tenant relationships, message history, channel and recipient validation, delivery status and a deliberate send action. Creating a conversation never sends a message implicitly.

### Tenancy Documents

Raw ID entry is replaced by property, tenancy and published-jurisdiction-policy selectors. The UI now exposes draft packet creation and the existing render, validate, approve and issue lifecycle, including status-gated actions and explicit issue confirmation.

### Key Register

The register now provides human property and holder labels, search and filters, validated device creation, explicit checkout/return/lost actions and append-only custody-event usage.

### Analytics

Operational snapshots now support 7/30/90-day and all-history ranges, latest-vs-previous comparisons, lightweight trend visuals, CSV export, history and explicit no-data/error states.

### Compliance

Administrators can select a property and run the existing authoritative compliance assessment rather than relying on a passive register. Assessment counts and clearer no-obligation guidance are surfaced.

## UX and configuration hardening

- Dashboard capacity rows resolve people directory display names instead of leading with raw user IDs.
- Client onboarding validates required data before moving through future steps and clears stale validation errors when corrected.
- Branding settings select an existing active profile when one exists and treat `New profile` as a true clean create state.
- Property onboarding no longer ignores blank Asset, Access Device or Alert actions.

## Infrastructure reconciliation

Production Firebase Admin token verification uses revocation checking and therefore requires read access to Identity Platform user state. The live API service account already received `roles/identityplatform.viewer` during production diagnosis. Terraform now declares the same least-privilege binding so infrastructure as code matches the working runtime configuration.

## Validation required before merge

This branch was authored through the GitHub repository connector and has not been executed in a local runtime by this remediation session. Do not merge or deploy on the basis of source review alone.

Validate the exact PR head under the repository-supported Node 22 / npm 10.9.x toolchain:

```text
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:rules
npm run test:emulator
npm run build
npm run verify:dist
npm run cloudflare:ci
npm audit --omit=dev --audit-level=high
```

Also run Terraform formatting and validation for the normal environment roots, then repeat the focused browser acceptance checks below.

## Focused acceptance re-test

1. Create a uniquely named QA client and property. The property must receive a non-draft ID, open its own route and remain present after refresh.
2. Create a QA inspection job from the QA property, load the job console and confirm the global loading indicator terminates.
3. Create/open a QA report and verify every Reports-register action resolves the same non-empty report ID.
4. Confirm an unassessed component does not count as a condition, cleaning or unable-to-confirm exception.
5. Exercise the route-plan create dialog and prove Cancel has no persistence side effect.
6. Test the application shell at 360, 390, 430 and 768 pixel widths.
7. Load the canonical catalogue and verify success, empty or actionable error/retry state, never an unbounded loader.
8. Create draft-only QA records in Communications, Document Packets and Key Register without contacting real recipients or altering genuine records.
9. Verify the API runtime retains Cloudflare edge protection, MFA/membership enforcement, the named Firestore database and the dedicated API service account.

## Separate production-build hardening

The existing application still loads Tailwind's browser CDN from `apps/web/index.html`. Removing it correctly requires introducing and locking a compiled Tailwind/PostCSS (or equivalent) build pipeline. That dependency/lockfile migration must be done under the supported npm toolchain and validated through the full Cloudflare build. Do not simply delete the CDN script, because the current class-based UI depends on it for styling.
