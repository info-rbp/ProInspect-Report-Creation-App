# Phase 6 report migration runbook

The migration is dry-run-first, resumable and non-destructive. Legacy source reports are not deleted by the migration command.

## Preparation

1. Build the shared packages and API.
2. Use a service account with read access to legacy top-level reports and write access to agency-scoped report, area, component and migration-receipt paths.
3. Export or otherwise checkpoint the Firestore database.
4. Confirm Cloud Storage objects referenced by legacy photos exist.

## Dry run

```bash
npm run build:packages
npm run build --workspace @pcr/api
MIGRATION_LIMIT=100 npm run migrate:reports --workspace @pcr/api
```

The command reads `/reports` in document-ID order and prints planned destination paths, area/component/photo-reference counts, warnings, failures and a `nextCursor`. Set `MIGRATION_AFTER` to resume after that cursor.

Dry runs do not write destination records or migration receipts.

## Apply

```bash
MIGRATION_LIMIT=100 MIGRATION_AFTER=<last-confirmed-id> \
  npm run migrate:reports --workspace @pcr/api -- --apply
```

Apply mode writes decomposed report records through the same aggregate store used by the API. It also records a receipt at:

```text
/agencies/{agencyId}/migrationRuns/phase6-{reportId}
```

Receipts contain source and destination paths, counts, warnings, timestamps and confirmation that the source was retained.

## Reconciliation

For each batch, compare:

- source report count against migration receipts
- source room count against destination area count
- source item count against destination component count
- usable source photo references against destination object-path references
- lifecycle status and optimistic version
- report identifiers, property, tenancy and inspection-job links

Investigate every skipped inline or missing photo reference. Firestore must not receive base64, file, blob, byte or preview payloads.

## Rollback

Because the source collection remains untouched, application traffic can be returned to the legacy read path during the controlled migration window. Delete only the affected agency-scoped destination documents and receipts after capturing evidence. Do not delete immutable versions independently of their parent migrated report.

## Production approval evidence

Record the following in issue #24 before closure:

- development and staging dry-run summaries
- applied batch cursors and document counts
- reconciliation results and exceptions
- Firestore checkpoint or export identifier
- Cloud Storage reference verification
- rollback rehearsal result
- production approver and execution window
- final confirmation that no active report depends on the legacy nested document
