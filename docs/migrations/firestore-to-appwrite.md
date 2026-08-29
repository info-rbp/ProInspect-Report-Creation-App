# Firestore to Appwrite mapping

This matrix was derived from the current ProInspect repository's Firestore repository, rules, workers, domain types, and documented `agencies/{agencyId}` model. Nested report structures require purpose-built transforms; they are not copied as opaque Firestore documents.

| Firestore source | Appwrite target | Transformation and risk |
| --- | --- | --- |
| `agencies/{agencyId}` | `agencies` | Preserve ID, organisation metadata, status, timestamps; reconcile settings separately. |
| `users/{uid}` | `user_profiles` | Profile only; credentials remain in Firebase Auth migration. Role moves to memberships. |
| `serviceProviders/{providerId}/memberships/{uid}` | membership/admin policy | Provider-wide role requires a business decision; do not infer cross-agency access. |
| `agencies/{agencyId}/memberships/{uid}` | `agency_memberships` | Map role/status/MFA requirement and validity. Existing property/job/report arrays need scoped membership or assignment mapping. |
| `clients` | `clients`, `client_contacts` | Split repeatable contacts; retain Shopify customer IDs as external references. |
| `properties` | `properties`, optional hierarchy tables | Retain property use, physical type, ownership, strata details, layout/version references, and standalone null site. |
| `tenancies`, `tenants`, `tenancyParticipants` | unresolved tenancy tables | Existing tenancy functionality is verified, but canonical Appwrite tenancy tables require a focused schema pass before import. |
| `inspectionRequests` | `inspection_requests`, `service_requests` | Create/resolve generic intake, retain source delivery/order/calendar references and deduplication IDs. |
| `inspectionJobs` | `inspection_jobs` | Preserve assignments, readiness, scheduling, lifecycle status, property snapshot, version. |
| `inspectionServiceMappings` | `shopify_service_mappings`, `service_definitions` | Split provider mapping from canonical operational service. Shopify remains financial authority. |
| `reports` | `reports` | Metadata only; no inline areas/components/files. Preserve lifecycle and current immutable version. |
| `reports/{reportId}/areas` | `inspection_sections` | Preserve sequence, canonical area identity/version, responsibility and visibility states. |
| `reports/{reportId}/areas/{areaId}/components` | `observations` | Preserve canonical component identity/version, condition, cleanliness, tested/working states, maintenance flag and evidence links. |
| `reports/{reportId}/versions` plus nested areas/components | `report_versions` plus immutable snapshot strategy | Compute/verify content hash. Exact snapshot decomposition needs performance testing before migration. |
| `reviewComments`, `tenantResponses` | migration TODO | Verified source paths; target tables require a dedicated report-response design rather than lossy generic JSON. |
| `photoEvidence`, `photos`, `uploadSessions` | `evidence_files` plus Storage | Copy binary separately, validate checksum/generation, then write metadata. Upload sessions are transient and normally not migrated. |
| `maintenanceCandidates` | `maintenance_candidates` | Preserve canonical source area/component versions, confidence and review disposition. |
| `maintenanceItems` | `maintenance_items` | Preserve mature state, priority, approvals, evidence, assignments, verification and optimistic version. |
| `maintenanceQuotes`, `contractorQuotes`, `contractorQuoteRequests` | matching quote/request tables | Preserve semantic differences and external contact/contractor references. |
| `maintenanceWorkOrders`, `workRequests` | matching tables | Preserve lifecycle, evidence and assignment history. |
| `tenantInstructions`, `clientApprovals`, `externalContacts` | matching tables where defined | `clientApprovals` needs a focused target decision before import; never merge approval semantics silently. |
| `auditEvents` | `audit_events` | Append-only import; preserve actor, action, target, correlation, outcome, request metadata and original timestamp. |
| `idempotencyKeys` | normally not migrated | Freeze legacy keys for rollback window; new Appwrite operations establish their own ledger. |
| `integrationConnections` | `integration_connections` | Migrate references/config only; secrets move through a secret manager, never rows or logs. |
| `integrationDeliveries`, `integrationSyncExceptions`, `integrationSyncRuns` | integration tables | Preserve provider IDs, delivery/dedup hashes, attempts, status and redacted errors. |
| `notificationJobs`, `taskOutbox` | `integration_outbox` or retained worker queues | Only pending/retryable work may be cut over after duplicate-delivery analysis. |
| `templates`, `documentTemplateVersions`, presentation template versions | inspection/report template tables or retained document domain | Requires a template-specific mapping; published versions remain immutable. |
| tenant documents/communications/portal grants/automation events | migration TODO | Verified current collections; target design must preserve immutable issued documents, grants, expiry, and communications audit. |
| catalogue/settings/branding/compliance/document packets | migration TODO | Verified current domains; handle after core operational cutover, with settings history and published-version rules. |

Required reconciliation: source count, eligible/skipped count, target count, per-row source/target checksum, missing relationship count, permission assignment count, immutable version hash count, binary checksum count, and status-distribution comparison.
