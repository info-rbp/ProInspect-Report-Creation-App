# Strata R2 to Appwrite mapping

Status: **BLOCKED pending source inspection**.

The R2 bucket names, object-key conventions, metadata, owning D1 rows, retention, and access rules were not available locally. Do not move objects based only on filename guesses.

The eventual matrix must record R2 bucket/key/version, owning source row, source checksum/size/type, target bucket/file ID, `evidence_files` row, agency/site/property/entity ownership, user/team permissions, legacy ID, retention/legal-hold status, and reconciliation result. Building Management operational evidence is expected to target `building-management-evidence`; contractor/property/report files may use their dedicated buckets when source semantics prove the match.
