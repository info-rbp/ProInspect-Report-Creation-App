# Firestore operational data model

Phase 6 stores operational records below an agency boundary and decomposes report content into bounded documents.

## Paths

```text
/agencies/{agencyId}
  /memberships/{userId}
  /clients/{clientId}
  /properties/{propertyId}
  /tenancies/{tenancyId}
  /inspectionJobs/{jobId}
  /reports/{reportId}
    /areas/{areaId}
      /components/{componentId}
    /versions/{versionId}
      /areas/{areaId}
        /components/{componentId}
    /reviewComments/{commentId}
    /tenantResponses/{responseId}
  /photos/{photoId}
  /templates/{templateId}
    /versions/{versionId}
  /analysisJobs/{analysisJobId}
  /pdfJobs/{pdfJobId}
  /notificationJobs/{notificationId}
  /auditEvents/{eventId}
```

The report document contains metadata, lifecycle state, counts and the current immutable version identifier. It never contains rooms, areas, components, photos, files or binary payloads.

## Component records

Each component stores its area and component identifiers, optional sub-component, material, colour and type, quantity, condition and cleanliness categories, working and test status, defects, maintenance flag, objective commentary, Cloud Storage photo references, AI confidence, review status, comparison status and optional tenant-response reference.

Explicit states cover not applicable, not visible, partially visible, untested, unable to confirm, operation confirmed, requires cleaning, repair required and replacement recommended.

## Media boundary

Originals, thumbnails and derivatives remain in Cloud Storage. Firestore stores only identifiers, object paths, captions and sequence values. The shared aggregate validator rejects inline files, blobs, byte fields, base64/data URIs and oversized strings.

## Draft persistence

`PUT /api/v1/reports/{reportId}/aggregate` replaces report metadata, areas and components in a bounded Firestore transaction. Existing records require an optimistic `expectedVersion`. Finalised and archived reports reject draft writes.

## Lifecycle transactions

`POST /api/v1/reports/{reportId}/transitions` atomically writes:

- report lifecycle status, assignment, timestamp and optimistic version
- the corresponding inspection-job status when a job exists
- an immutable version for approval, tenant submission, finalisation and archival states
- a material audit event
- a notification request

All transaction reads occur before writes. The implementation reserves headroom below Firestore's transaction write ceiling and rejects aggregates that cannot be safely committed atomically.

## Immutable versions

A version document contains lifecycle metadata, counts and a content hash. Its area and component snapshots are stored as nested version subcollections, not as one large snapshot field. Versions are create-only from the backend and all browser writes are denied by Firestore rules.

## Legacy compatibility

The old top-level `/reports/{reportId}` collection is read-only during migration. New cloud saves use agency-scoped report aggregates. Legacy documents are retained until reconciliation and rollback approval are complete.
