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
