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
| `tenancies`, `tenants`, `tenancyParticipants` | `tenancies`, `tenants`, `tenancy_participants` | Preserve person/portal/lease distinctions, lifecycle, dates and participant roles; resolve properties first. |
| `inspectionRequests` | `inspection_requests`, `service_requests` | Create/resolve generic intake, retain source delivery/order/calendar references and deduplication IDs. |
| `inspectionJobs` | `inspection_jobs` | Preserve assignments, readiness, scheduling, lifecycle status, property snapshot, version. |
| `inspectionServiceMappings` | `shopify_service_mappings`, `service_definitions` | Split provider mapping from canonical operational service. Shopify remains financial authority. |
| `reports` | `reports` | Metadata only; no inline areas/components/files. Preserve lifecycle and current immutable version. |
| `reports/{reportId}/areas` | `inspection_sections` | Preserve sequence, canonical area identity/version, responsibility and visibility states. |
| `reports/{reportId}/areas/{areaId}/components` | `observations` | Preserve canonical component identity/version, condition, cleanliness, tested/working states, maintenance flag and evidence links. |
| `reports/{reportId}/versions` plus nested areas/components | `report_versions` plus immutable snapshot strategy | Compute/verify content hash. Exact snapshot decomposition needs performance testing before migration. |
| `reviewComments`, `tenantResponses` | `report_review_comments`, `report_recipient_responses` | Preserve report/version/scope, author/respondent, lifecycle and resolution; import after immutable report versions. |
| `photoEvidence`, `photos`, `uploadSessions` | `evidence_files` plus Storage | Copy binary separately, validate checksum/generation, then write metadata. Upload sessions are transient and normally not migrated. |
| `maintenanceCandidates` | `maintenance_candidates` | Preserve canonical source area/component versions, confidence and review disposition. |
| `maintenanceItems` | `maintenance_items` | Preserve mature state, priority, approvals, evidence, assignments, verification and optimistic version. |
| `maintenanceQuotes`, `contractorQuotes`, `contractorQuoteRequests` | matching quote/request tables | Preserve semantic differences and external contact/contractor references. |
| `maintenanceWorkOrders`, `workRequests` | matching tables | Preserve lifecycle, evidence and assignment history. |
| `tenantInstructions`, `clientApprovals`, `externalContacts` | `tenant_instructions`, `operational_approvals` only when semantically operational, `external_contacts` | Client approvals require an explicit approval-kind transform; never merge approval semantics silently. |
| `auditEvents` | `audit_events` | Append-only import; preserve actor, action, target, correlation, outcome, request metadata and original timestamp. |
| `idempotencyKeys` | normally not migrated | Freeze legacy keys for rollback window; new Appwrite operations establish their own ledger. |
| `integrationConnections` | `integration_connections` | Migrate references/config only; secrets move through a secret manager, never rows or logs. |
| `integrationDeliveries`, `integrationSyncExceptions`, `integrationSyncRuns` | integration tables | Preserve provider IDs, delivery/dedup hashes, attempts, status and redacted errors. |
| `notificationJobs`, `taskOutbox` | `integration_outbox` or retained worker queues | Only pending/retryable work may be cut over after duplicate-delivery analysis. |
| `templates`, `documentTemplateVersions`, presentation template versions | inspection/report template tables or retained document domain | Requires a template-specific mapping; published versions remain immutable. |
| tenant documents/communications/portal grants/automation events | `tenancy_documents`, `tenant_communications`, `tenant_portal_grants`, audit/outbox | Preserve immutable issued documents, grants, expiry and communications audit; automation history is retained only when statutory or pending. |
| catalogue/settings/branding/compliance/document packets | migration TODO | Verified current domains; handle after core operational cutover, with settings history and published-version rules. |

Required reconciliation: source count, eligible/skipped count, target count, per-row source/target checksum, missing relationship count, permission assignment count, immutable version hash count, binary checksum count, and status-distribution comparison.

## Active collection registry

All sources below are agency subcollections unless an absolute or nested path is shown. Source document ID is preserved as `legacyId`; the target ID is deterministic from `firestore:<collection>:<document-id>`. Timestamps are normalized to ISO UTC. Agency membership, entity assignment, tenancy/portal grant, report lifecycle and immutable-version permissions are evaluated by the API before row permissions are emitted. `Order` is the migration stage; `defer` means the collection is source-verified but not eligible for the first bounded import.

| Firestore collection/path | Structure and relationship | Target / transformation | Order |
| --- | --- | --- | ---: |
| `agencies` | top-level tenancy root | `agencies`; preserve ID/status/settings reference | 1 |
| `users` | top-level profile, Firebase UID | `user_profiles`; credentials excluded | defer |
| `serviceProviders/*/memberships` | provider-wide role/scope | business mapping decision; never infer agency access | defer |
| `agencies/*/memberships` | UID role/status/MFA and scoped IDs | `agency_memberships` plus explicit assignments/grants | defer |
| `invitations` | invited identity/role/expiry | Appwrite invite workflow + pending membership | defer |
| `agencySettings` | versioned operational/security settings | future settings tables; retain history and secret references only | defer |
| `clients` | client account aggregate | `clients`; split repeatable contacts/relationships | 2 |
| `clientContacts` | client contact, multi-role/preferences | `client_contacts` | 6 |
| `clientEngagements` | account service agreement/lifecycle | deferred canonical engagement schema | defer |
| `propertyClientRelationships` | property/account/type/dates | `property_client_relationships` | 5 |
| `clientDocuments` | metadata + Storage object | `documents`/`evidence_files` with client owner | defer |
| `clientPortalUsers` | user/account permissions/status | agency membership + future client portal grant | defer |
| `clientTimelineEvents` | client audit/timeline event | `audit_events` where immutable/material; otherwise derived | defer |
| `clientApprovals` | approval kind/target/decision | explicit kind transform; never merge blindly | defer |
| `properties` | physical/use/ownership/tenancy/layout aggregate | `properties`; site nullable | 4 |
| `propertyLayoutVersions` | immutable hierarchy snapshot | retained snapshot/version design; derive hierarchy rows | defer |
| `propertyFloorPlans` | document/image metadata | `documents` + `evidence_files` | defer |
| `propertyDocumentUploads` | temporary upload workflow | normally not migrated; completed object handled separately | defer |
| `propertyDocuments` | authoritative document metadata | `documents` + `evidence_files` | defer |
| `propertyDocumentAnalyses` | derived analysis result | retain only accepted/current result with model provenance | defer |
| `tenants` | tenant directory/person contact | `tenants` and optional `people` link | defer |
| `tenancies` | property lifecycle/dates/parties | `tenancies` | defer |
| `tenancyParticipants` | tenancy/person/role/status | `tenancy_participants` | defer |
| `tenantCommunications` | tenancy direction/channel/content/status | `tenant_communications` | defer |
| `tenancyDocuments` | version/status/signers/file | `tenancy_documents`; issued/signed immutable | defer |
| `tenantInstructions` | tenancy/item instruction lifecycle | `tenant_instructions` | defer |
| `tenantPortalGrants` | tenancy/user/permissions/expiry | `tenant_portal_grants` | defer |
| `tenantAutomationEvents` | workflow history/retry state | pending only to outbox; material results to audit | defer |
| `tenantResponses` | report recipient response | `report_recipient_responses` | defer |
| `serviceDefinitions` | generic code/category/workflow | `service_definitions` | defer |
| `inspectionServiceMappings` | provider product/variant/service | `shopify_service_mappings` | defer |
| `inspectionRequests` | intake/payment/booking/property match | `inspection_requests` and resolved `service_requests` | defer |
| `inspectionJobs` | assignment/schedule/readiness/snapshot | `inspection_jobs` | defer |
| `inspectionCommunications` | job communication/delivery | `communications` with inspection target | defer |
| `inspectionOperationalEvents` | job state/event history | `audit_events` | defer |
| `inspectorCapabilityProfiles` | inspector availability/skills/scope | membership/assignment profile; schema decision required | defer |
| `recurringInspectionSchedules` | recurrence/property/type | `preventive_maintenance` only if service semantics match; otherwise defer | defer |
| `inspectionRoutePlans` | route/date/assignments/version | deferred route-plan schema | defer |
| `remoteInspectionAssignments` | remote participant/grant/state | deferred remote-inspection schema | defer |
| `remoteInspectionSubmissions` | remote evidence/submission | inspection/evidence transform after design | defer |
| `templates` | inspection/report template identity | `inspection_templates` or document template by kind | defer |
| `templateVersions` / `versions` | published immutable definition | `inspection_template_versions`; hash verify | defer |
| `reports` | report metadata/lifecycle/current version | `reports`; no embedded aggregate | defer |
| `reports/*/areas` | ordered canonical area snapshot | `inspection_sections` | defer |
| `reports/*/areas/*/components` | assessment/testing/commentary | `observations` | defer |
| `reports/*/versions` | immutable aggregate snapshot | `report_versions`; full hash verification | defer |
| `reportVersions` | legacy/top-level version index | deduplicate against nested versions; no double import | defer |
| `reviewComments` | report/area/component/evidence scope | `report_review_comments` | defer |
| `reportDistributions` | version/recipient/delivery/access | `report_distributions` | defer |
| `reportAcknowledgements` | version/distribution acknowledgement | `report_acknowledgements` | defer |
| `reportRecipientResponses` | respondent comments/resolution | `report_recipient_responses` | defer |
| `reportSupersessions` | old/new version/reason/authority | `report_supersessions` | defer |
| `reportBrandingProfileVersions` | immutable branding snapshot | retain with report presentation version design | defer |
| `reportPresentationTemplateVersions` | immutable presentation definition | retained template-version design | defer |
| `photoEvidence` / `photos` | evidence metadata/object reference | `inspection_evidence` + `evidence_files` | defer |
| `uploadSessions` | expiring temporary upload state | do not migrate except active cutover sessions by exception | defer |
| `analysisJobs` | transient/derived worker state | only queued/running cutover jobs after duplicate analysis | defer |
| `pdfJobs` | transient/derived PDF work | only queued/running cutover jobs after duplicate analysis | defer |
| `maintenanceCandidates` | report/observation/canonical sources | `maintenance_candidates` | defer |
| `maintenanceItems` | triaged issue/workflow/version | `maintenance_items` | defer |
| `maintenanceEstimates` | options/basis/status | `maintenance_estimates` | defer |
| `maintenanceQuotes` | client commercial quote/current version | `maintenance_quotes` | defer |
| `maintenanceQuoteVersions` | immutable commercial version | future quote-version table or immutable snapshot field; blocked | defer |
| `quoteApprovalPolicies` | thresholds/requirements/version | future policy-version schema; blocked | defer |
| `contractorQuoteRequests` | vendor solicitation | `contractor_quote_requests` | defer |
| `contractorQuotes` | vendor response | `contractor_quotes` | defer |
| `maintenanceWorkOrders` | approved scope/assignment/completion | `maintenance_work_orders`, `sourceType=firestore` | defer |
| `maintenanceVariations` | scope/cost approval | `maintenance_variations` | defer |
| `preventiveMaintenanceSchedules` | property/asset recurrence | `preventive_maintenance` | defer |
| `warrantyClaims` | item/asset/provider lifecycle | `warranty_claims` | defer |
| `workRequests` | external-contact work instruction | `work_requests` | defer |
| `priceBooks` | commercial price-book identity | deferred price-book schema; financial review required | defer |
| `priceBookVersions` | immutable entries/version | deferred price-book version schema | defer |
| `priceBookImports` | upload/import errors/status | historical imports omitted; current published provenance retained | defer |
| `externalContacts` | non-authenticated contact | `external_contacts` | defer |
| `externalAccessGrants` | token hash/entity/expiry | reissue Appwrite grant; never migrate raw token | defer |
| `contractorQuoteAccessGrants` | quote token hash/expiry | reissue only if still required; never raw token | defer |
| `communicationThreads` | participants/subject/entity | deferred thread schema; do not flatten into delivery rows | defer |
| `communicationMessages` | thread/direction/content/delivery | deferred message schema or `communications` transform | defer |
| `notificationJobs` | retryable delivery work | pending-only `notifications`/outbox after dedupe | defer |
| `documentPackets` | grouped/versioned documents | deferred packet schema; preserve approval/issue lifecycle | defer |
| `documentTemplateVersions` | immutable template | deferred document-template schema | defer |
| `esignEnvelopes` | provider envelope/signers/status | reference-only; provider remains authority | defer |
| `jurisdictionPolicyVersions` | immutable policy rules | deferred policy-version schema | defer |
| `complianceRuleVersions` | immutable rule definition | deferred compliance schema | defer |
| `complianceObligations` | entity obligation/status/evidence | deferred compliance schema | defer |
| `serviceRecords` | property/service completion record | `service_events` only after semantic transform | defer |
| `integrationConnections` | provider/config/secret reference | `integration_connections`; secret moves separately | defer |
| `integrationDeliveries` | provider delivery/dedupe/status | `integration_deliveries` | defer |
| `integrationSyncRuns` | connector run/count/status | outbox/audit or future sync-run schema | defer |
| `integrationSyncExceptions` | run/entity/error/resolution | `integration_exceptions` | defer |
| `pmsConnections` | PMS provider/reference/config | `integration_connections` with provider `pms` | defer |
| `externalReferences` | provider/entity/external ID | preserve on owning row or future reference table | defer |
| `auditEvents` | append-only actor/action/entity/outcome | `audit_events`; original time retained | defer |

Collections not explicitly migrated because they are derived/cache, transient, credentials, or unsupported are still reconciled by source count and classified as deliberately skipped. A collection marked deferred is not migration-ready merely because a target name exists.
