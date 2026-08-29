# Appwrite migration preparation

These documents describe mappings only. No production user, row, or file migration has run. Every importer must use `migration_id_map`, deterministic target IDs, source/target checksums, dry-run output, resumable checkpoints, idempotent upsert behavior, reconciliation counts, and redacted errors.

The recommended first rehearsal is a small non-sensitive Development subset of Agency -> Clients -> Managed Sites -> Properties -> Property Client Relationships -> Client Contacts. It intentionally excludes identities, memberships, Shopify events, inspections, reports, evidence and operational rows. Inspection/report and evidence migration should follow only after immutability and permission tests pass.
