# Firebase Storage to Appwrite Storage

Verified ProInspect storage concepts include inspection originals, derived evidence, temporary uploads, final-report assets/archives, branding assets, property documents, and tenancy documents. Existing object generation and SHA-256 metadata must be retained where available.

| Source class | Target bucket | Notes |
| --- | --- | --- |
| inspection originals/derivatives | `inspection-evidence` | Keep original/derivative category in `evidence_files`; never overwrite originals. |
| maintenance evidence | `maintenance-evidence` | Link to item/work order and preserve completion vs source evidence. |
| property/tenancy documents | `property-documents` | Preserve owning entity, immutable issued-document state, content hash and generation. |
| contractor documents | `contractor-documents` | Apply contractor/site scope; validate expiry and document category. |
| final reports/archives | `reports` | Content-hash, immutable version, released recipient permissions. |
| transient upload objects | `temporary-uploads` | Recreate only active safe uploads; otherwise expire rather than migrate. |

For each object: read source metadata, stream without logging content, compute checksum, upload with deny-by-default file permissions, verify size/checksum, create `evidence_files`, record legacy bucket/path/generation in migration metadata, and reconcile failures. Do not delete Firebase objects until authority switch, retention approval, and restore testing.

Verified source path classes include inspection originals/derived assets and upload sessions from the photo evidence store, property and tenancy document paths, branding asset uploads, report generation/final archives, maintenance/contractor evidence and transient worker inputs. Exact bucket/path/generation are read from each owning Firestore document; a filename is never used to infer ownership.

| Source path class | Entity owner | Appwrite file permission | Reconciliation |
| --- | --- | --- | --- |
| inspection original/derivative | agency/property/job/report/observation | assigned inspector, reviewer/operations and explicitly released recipients only | generation, bytes, SHA-256, media type, category and owner links |
| maintenance/work-order evidence | agency/property/item/work order | assigned contractor for own permitted evidence plus maintenance roles | source/completion category, assignment, bytes/hash |
| property/tenancy/client document | agency/property/tenancy/client | entity capability and active portal grant; issued tenancy docs immutable | version, issue state, bytes/hash, permission count |
| report asset/archive | report/version/distribution | report roles and released recipients | report content hash plus file hash |
| branding asset | agency/branding version | settings managers; public delivery only through approved presentation path | version, media dimensions/type, bytes/hash |
| temporary worker/upload input | expiring upload session/job | uploader and worker only | normally skipped; active eligible count and expiry |

Any object lacking authoritative agency/entity metadata is blocked and quarantined for a mapping decision. The migration never copies Firebase download tokens as Appwrite permissions. Target files are created with file security and no bucket-wide access; unauthorized user, other-agency, other-site, resident, contractor and expired-grant downloads must all fail before readiness.
