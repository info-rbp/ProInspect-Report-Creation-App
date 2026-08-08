# Phase 7 photo and offline handling

## Storage layout

Managed object prefixes are:

- `inspection-originals`
- `inspection-derived`
- `temporary-uploads`
- `final-report-assets`
- `final-report-archives`

Original evidence paths include agency, inspection job, upload session and SHA-256 digest. Upload sessions use the Cloud Storage `ifGenerationMatch=0` precondition so an existing object generation cannot be replaced. Browser Firebase Storage writes are denied. Only API-issued resumable upload URLs may create originals.

## Upload workflow

1. The client hashes the local image and requests an upload session.
2. The API validates agency, property and inspection job access.
3. Existing original evidence with the same job and SHA-256 digest is returned as a duplicate.
4. Otherwise the API creates a Firestore upload-session record and a restricted resumable upload URL.
5. The browser uploads in 8 MiB chunks and persists the session URL and byte offset in IndexedDB.
6. A storage completion event calls the evidence completion handler with generation, size and hash metadata.
7. The handler validates the issued object path and immutable generation, writes the original evidence metadata and queues derivative processing atomically.
8. Workers create thumbnails and analysis derivatives under `inspection-derived`; originals are never modified.

## Evidence metadata

Every original record contains original filename, object path, content type, file size, SHA-256 digest, upload timestamp, uploader, property, inspection job, optional report and area links, component links, asset kind, processing status and Cloud Storage generation.

## Offline workspace

IndexedDB is a controlled workspace, not the system of record. It stores downloaded jobs, local drafts, photo blobs, resumable upload progress, a mutation outbox and the explicit all-evidence-uploaded confirmation. Reconnection triggers retry. Draft mutations carry the cloud version used when editing began; a changed server version produces a conflict rather than a silent overwrite.

Inspection submission is blocked until every photo and mutation is synced and the inspector explicitly confirms all evidence has uploaded.

## Retention and recovery

Enable Cloud Storage soft delete or object versioning in each environment and test recovery before production activation. Do not lock a retention policy until the business has approved the exact period and legal consequences. Locked retention is deliberately outside repository automation.

## Environment verification

Before closing the Phase 7 issue, attach development and staging evidence for resumable upload recovery, page-refresh recovery, duplicate detection, overwrite rejection, offline inspection completion, derivative processing and a soft-delete or versioning recovery drill.
