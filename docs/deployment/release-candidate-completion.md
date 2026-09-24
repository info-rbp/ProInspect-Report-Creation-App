# Release candidate completion evidence

Baseline verified 2026-09-24: `origin/feat/launch-readiness-installation-v2`
`1e6a80303a07e5b3775c0245d5bcc870df72234b`. Started with a clean tree;
completion branch `feat/proinspect-release-candidate-completion`. Main was not
used as the implementation baseline. No provider mutation has been performed.

## Baseline command record

Node 22.23.2 / npm 10.9.8 (current repository pins). Full local outputs are private
under `.git/proinspect-rc-evidence/baseline/`; they are not launch acceptance.

| Command | Exit | Evidence / blocker | Classification | Remediation / recheck |
| --- | --- | --- | --- | --- |
| `git fetch --all --prune` | 0 | Baseline remote equals supplied SHA | Read only | Completion branch created from verified remote |
| `npm ci --ignore-scripts --no-audit --no-fund` | 0 | 1101 packages installed | Local | No audit force or lifecycle scripts |
| `npm run launch:audit` | 0 | 19 gates, 159 assertions; integrity pass | Source | Rebuilt integrity after credential changes |
| `npm run launch:test` | 0 | Existing regression suite passes | Source | Extended credential regressions |
| `npm run launch:preflight -- --all` | 2 | 14 blockers, 1 warning, 1 advisory | Mixed | Details below; remains fail closed |
| `npm run launch:issues` | 0 | OPEN_BLOCKERS (command exit is not acceptance) | Mixed | Private v2.7 ledger retained |
| `npm run launch:authority` | 1 | Firebase dependencies/imports in five workers | Source-fixable | Worker conversion required |
| `npm run launch:plan` | 0 | PLAN_ONLY; no mutations | Local | Order preserved |
| `npm run check` | 0 | Format/lint/types/unit/rules/schema/build/dist pass; 57.8 seconds | Source | Generated build caches restored only |
| `npm run launch:complete -- --stage transactions` | 1 then 0 | First blocked by generated build caches; then workpack created | Source | Restored only validation-generated caches after check completed |

Preflight exact blockers: Configuration requires named approval; application and
worker write freeze is not approved; wrong Terraform version (requires 1.15.0);
legacy worker authority; migration bundle must be an absolute private directory
outside checkout; private Terraform input missing `(unset)`; no reviewed
per-service runtime credential policies; missing `APPWRITE_SEED_PASSWORD`,
`PROINSPECT_EDGE_SECRET`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`;
provider checks cannot run before approved configuration. Configuration/authority
also recur at source-stage scope. Physical device evidence is a warning at
installation preparation and remains mandatory for acceptance. Production is
intentionally locked outside `launch:release`.

## Stored credential import

Replaced unsupported stored-key creation with Console-created key verification
and import. Project identity, key ID/name/scopes/expiry and plaintext are verified
through authenticated CLI control-plane lookup. Secret publication uses stdin,
requires an ENABLED immutable numeric Secret Manager version, and reads it back
before saving configuration. Rotation preserves the previous binding on failure
and bounds rollback retention. Temporary operation credentials are imported,
revoked after use, and checked absent. Sensitive command output cannot be written
to a log and import secrets are removed from child-process environments.

Regression coverage includes wrong project, prohibited target, wrong scopes,
missing and unverifiable credentials, malformed metadata, expired/near-expiry and
excess-lifetime keys, no ephemeral fallback, output/argument leakage, rotation,
rollback retention, revocation failure, failed publication/readback/config save.
No real operator credential was supplied or imported during these source tests.
