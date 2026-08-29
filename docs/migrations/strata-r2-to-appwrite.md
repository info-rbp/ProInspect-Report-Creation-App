# Strata R2 to Appwrite Storage matrix

## Verified source contract

Strata-Site binds `EVIDENCE` to R2 bucket `pmhub-evidence`. New uploads are at `<propertyId>/<yyyy>/<mm>/<generated-id>-<sanitised-name>`, maximum 15 MiB, and allow JPEG, PNG, WebP, HEIC/HEIF, PDF and plain text. Metadata includes property ID, uploader user/role, original name and upload timestamp. Reads resolve property ownership from metadata or the property-prefixed key; unscoped legacy objects are denied. Residents and contractors may retrieve only their own uploads through the secure route.

| R2 owner/path | Appwrite bucket | Metadata target | Ownership and permissions | Reconciliation |
| --- | --- | --- | --- | --- |
| Defect `defect_evidence.r2_key` | `building-management-evidence` | `evidence_files`, entity `defect` | Agency/site/defect; assigned operational roles; uploader where explicitly allowed. | D1 row/object existence, bytes, MIME, SHA-256, target size/hash. |
| Daily activity `evidence_r2_key` | `building-management-evidence` | `evidence_files`, entity `daily_activity_log` | Site activity scope; no key-possession authority. | Owning row and checksum parity. |
| Work-order service report | `contractor-documents` | `evidence_files`, entity `maintenance_work_order` | Assigned contractor + authorised site roles. | Owning assignment, MIME/size/hash. |
| Contractor attendance report | `contractor-documents` | `evidence_files`, entity `contractor_attendance` | Own contractor attendance + site roles. | Assignment and hash parity. |
| Access request owner authority | `building-management-evidence` | `evidence_files`, entity `access_device_request` | Requestor and device managers; restricted document. | Unit/request ownership and checksum. |
| Waste/incident/by-law evidence | `building-management-evidence` | `evidence_files`, corresponding entity | Relevant restricted capability, never site-wide public. | Entity link and checksum. |
| `documents.r2_key` | `property-documents` or `contractor-documents` by category | `documents` + `evidence_files` | Preserve `internal`, `resident_visible`, or `restricted`; resident still needs site/occupancy. | Version, visibility, source object and checksum. |
| Report export or future report object | `reports` | operational report/version + `evidence_files` | Released recipients and report roles; immutable. | Snapshot hash and file hash. |
| Property-prefixed object with verified metadata but no owning D1 row | quarantine/review, no automatic import | pending migration exception | No user permission until ownership is approved. | Count and redacted key hash only. |
| `shared/*` or legacy unscoped object | no automatic target | migration exception | Deny; never infer property from filename. | Count only, manual ownership decision. |

The importer streams content without logging it, verifies source size/type, computes SHA-256, uploads with explicit file permissions, re-reads target metadata, writes `evidence_files`, and records both identities/checksums. Source objects are never deleted in this task. Unsupported types, files over target policy, missing ownership, hash mismatch, and permission-generation failures block the object and are reported without exposing its key or contents.
