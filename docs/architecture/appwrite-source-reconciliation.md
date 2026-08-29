# Appwrite source reconciliation

## Evidence and scope

This decision record compares the checked-in 67-table Appwrite foundation with:

- ProInspect at `31d13bac936f6880efd4148f99e6bbe9084f2ce5`: domain types, API route catalogue, Firestore repositories/rules/indexes, Firebase identity/MFA policy, Storage rules and upload code, Shopify services, and all worker entry points.
- Strata-Site at `1a1ab340e93f72f7662ba8b8ca8b007e0e519ad9`: all six D1 migrations in order, 49 resulting tables, 21 explicit indexes, two finalised-report triggers, authentication/session middleware, capability policy, operational routes, and the `pmhub-evidence` R2 binding.
- Appwrite Development before correction: `proinspect_core`, 67 tables, 993 columns, 191 indexes, seven buckets and two teams.

Firebase/Firestore, Firebase Storage, D1/R2 and Shopify remain authoritative. This report authorises Development schema preparation only; it does not authorise data cutover, dual write, or any Production mutation.

## 1. Current Appwrite schema

The foundation correctly established agency tenancy, row security, separate file buckets, immutable version concepts, integration deduplication, and migration identity. It was incomplete where the unavailable Strata source had been represented by thin candidate tables. The most material gaps were people/occupancy, units, contractor companies, the controlled-key register, access-device requests, defects, operational inspection checkpoints/results, D1 operational support tables, and source-faithful report finalisation.

## 2. Verified source entities

ProInspect confirms agency memberships, clients/contacts, properties/layout, tenants/tenancies, inspection intake/jobs/report aggregates, evidence, maintenance commercial workflows, audit, Shopify/Calendar integration, settings/templates, and worker queues. Strata confirms the 49 D1 tables listed in the D1 migration matrix, seven roles, property-scoped portal access, detailed operational forms, and a single R2 bucket with property-prefixed object keys and uploader metadata.

The dashboard worker directly reads agency Firestore collections across jobs, reports, maintenance, tenant actions, approvals, quotes, integrations, documents, compliance, communications, route plans, keys, remote inspections and evidence. The notification worker directly reads tenancy/tenant/document/rule/template/job collections. The PDF worker directly reads nested immutable report versions/areas/components, tenant responses and presentation/branding versions and reads/writes Firebase Storage. The document worker reads template objects from Firebase Storage and verifies hashes. The integration worker uses Firestore-backed connector state. These workers must be repointed per domain after repository parity; they remain unchanged during the first bounded migration. The AI worker did not expose a direct Firestore/Storage dependency in its source entry point.

Shopify inspection intake currently validates HMAC, records delivery IDs for replay safety, encrypts credentials behind references, pins an API version, preserves financial/fulfilment/refund/cancellation facts and reconciles missed deliveries. The target corrects its inspection-specific entry shape by routing every mapped line through generic service definition/request entities before an inspection workflow is selected.

## 3. Recommended final schema

Use `agency -> managed site -> inspectable property/unit -> location` as the physical and tenancy boundary. A Strata D1 `properties` row becomes a managed site; D1 `units` become units and may resolve to an inspectable `properties` row when appropriate. `people`, `tenants`, `tenancies`, `tenancy_participants`, and `occupancies` remain separate because a person, portal identity, lease participant, and current resident are not interchangeable.

Property inspection reports and Building Management monthly reports remain separate domains. They share evidence, audit, permissions, checksums, and immutable-release infrastructure, but not lifecycle tables. ProInspect maintenance items and Strata defects also remain separate. A defect may create/link a maintenance item or work order without losing its source workflow.

## 4. Tables to retain

All 67 foundation table IDs remain during this correction. No destructive deletion is justified before Development migration transforms prove equivalence. The manifest in `infrastructure/appwrite/tables/reconciliation.mjs` is the machine-checked record of their source, classification, and action.

## 5. Tables to change

Change the thin tables classified `REQUIRES_CHANGE` in the matrix below. The changes add source fields without renaming or deleting existing columns, preserving seed compatibility and allowing idempotent backfill. In particular, change clients/contacts/properties/hierarchy; operational activity, resident, contractor, key/device, move, inspection, asset/waste/incident/by-law/report tables; audit; and cross-source work orders.

## 6. Tables to remove

None in this iteration. `preventive_maintenance` and `maintenance_plans` overlap, as do some communication and inspection-template concepts, but their current sources have materially different lifecycle and payload semantics. Removal or consolidation is blocked until real Development transforms and query workloads demonstrate lossless equivalence.

## 7. Tables to add

Add source-backed tables for `people`, `tenants`, `tenancies`, `tenancy_participants`, `occupancies`, `units`, `contractors`, `property_client_relationships`, `key_register`, `access_device_requests`, `defects`, operational work orders, operational inspection checkpoints/results, `service_events`, `waste_services`, `tasks`, `calendar_events`, `documents`, `inventory_items`, `notifications`, `form_submissions`, `property_operating_settings`, operational quotes/approvals, report review/distribution/acknowledgement/response/supersession, tenant communications/documents, and tenant portal grants.

## 8. Field decisions

Cross-cutting target-only fields (`agencyId`, `managedSiteId`, `status`, timestamps, audit actors, `legacySystem`, `legacyId`) are intentional canonical fields: they make tenancy enforcement and reconciliation explicit without deep relationship traversal. `sourceType`, content hashes, immutable flags, correlation IDs, and JSON snapshots are likewise introduced for provenance, idempotency, immutable releases, and source payloads whose nested structure is API-validated.

Legacy password hashes and sessions are omitted because they are security credentials, not operational data, and Appwrite authentication requires reauthentication/invitation. D1 `property_scope` is transformed to site membership. R2 keys are not exposed as authority; they become legacy references on scoped `evidence_files` rows. Transient upload sessions, derived dashboard snapshots, completed notification jobs, and processed outbox rows are omitted unless a cutover-window rule explicitly marks them eligible.

## 9. Relationship changes

- Replace the single `properties.clientId` assumption with `property_client_relationships`; keep `clientId` only as a compatibility/default relationship during transition.
- Add units and occupancies below a managed site; do not model a resident as a tenant or owner.
- Link key transactions to `key_register`, access devices to requests/units/people, and contractor attendance to contractor company plus user where available.
- Link defects independently to requests, locations, units, assets, contractors, work orders and evidence.
- Link final operational reports to a source draft and immutable snapshot rather than mutating a finalised draft.

## 10. Index changes

Add source-backed indexes for site/unit occupancy, active tenancy participants, property/status operational queues, defect follow-up, contractor attendance, key/device history, due tasks, calendar ranges, unread notifications, form idempotency, outbox state, and report month uniqueness. Every index is defined next to the source-controlled table and validated against real columns.

## 11. Security changes

Rows and buckets remain deny-by-default with row/file security. Appwrite Teams are coarse grouping only; API policy remains authoritative. The merged role model keeps ProInspect internal roles and maps Strata roles without broadening them: system administrator requires an explicitly approved platform-admin mapping; strata/council are multi-site within assigned agency scope; building manager, relief manager, contractor and resident require site scope; relief expiry remains mandatory. Resident reads require own occupancy/portal grant. Contractor reads require assignment or own attendance/upload. Inspector reads require assignment. Privileged ProInspect roles continue to require verified MFA and separation of duties.

Final report, operational report and audit immutability cannot rely on Appwrite row permissions against server keys. API write gateways must reject update/delete, create superseding immutable versions, issue audit events, and use least-scope server keys. These gates must pass before the relevant migration is READY.

## 12. Migration order changes

The first bounded dependency chain is `agency -> clients -> managed sites -> properties -> property-client relationships -> client contacts`. Identity comes later because it adds MFA and invitation dependencies. Core Strata migration begins with site/people/units/occupancies before operational rows. Evidence metadata migrates before binary copy reconciliation, but application authority changes only after file checksum and denial tests pass.

## 13. Unresolved business decisions

- Decide whether a D1 unit always creates a ProInspect inspectable property or only when inspection services are enabled.
- Approve the final cross-product role names and the mapping for Strata `system_administrator`, owner-occupiers, council members, contractor companies and contractor users.
- Decide whether D1 maintenance plans converge with ProInspect preventive schedules after migration.
- Approve retention/legal-hold policies, Appwrite evidence size limits, SMTP/verified domains, OAuth providers, and privileged MFA enrolment/recovery operations.
- Confirm whether historic notifications, processed outbox events, form payloads, and raw report snapshots require migration for statutory retention.

## 14. Migration risks

The highest risks are identity/MFA regression, inferred resident/owner/tenant equivalence, cross-site data leakage, mutable final reports, lossy defect-to-maintenance merging, orphaned R2 evidence, Shopify financial drift, and duplicate worker deliveries. Each is controlled by deterministic ID maps, source/target checksums, explicit relationship exception reports, deny-by-default permissions, immutable-version gates, dry-run-only first rehearsals, and source authority remaining unchanged.

## Foundation table reconciliation

| Appwrite table | Source | Status | Recommended action |
| --- | --- | --- | --- |
| agencies | Firestore `agencies` | VERIFIED | Retain tenancy root. |
| managed_sites | Canonical from Strata `properties` | NEW_CANONICAL_ENTITY | Retain scheme/site above inspectable property. |
| user_profiles | Firestore users + D1 users/people | REQUIRES_CHANGE | Profile only; no password/session data. |
| agency_memberships | Firestore memberships | VERIFIED | Retain agency role and MFA requirement. |
| site_memberships | D1 property scope + canonical | NEW_CANONICAL_ENTITY | Retain explicit site scope and validity. |
| clients | Firestore clients | REQUIRES_CHANGE | Add account/billing/preference fields. |
| client_contacts | Firestore clientContacts | REQUIRES_CHANGE | Add multi-role/contact preference fields. |
| properties | Firestore properties + D1 units transform | REQUIRES_CHANGE | Preserve inspectable property/lot semantics. |
| buildings | Firestore layout + D1 buildings | REQUIRES_CHANGE | Support site/source property parent. |
| property_levels | Firestore layout levels | NEW_CANONICAL_ENTITY | Normalize level nodes. |
| property_areas | Firestore areas + D1 locations | REQUIRES_CHANGE | Preserve location/responsibility semantics. |
| service_definitions | Firestore services | NEW_CANONICAL_ENTITY | Retain generic service catalogue. |
| service_requests | Shopify/Firestore intake | NEW_CANONICAL_ENTITY | Retain generic workflow intake. |
| service_request_items | Shopify lines + canonical | NEW_CANONICAL_ENTITY | Preserve quantity/provider line refs. |
| shopify_service_mappings | Shopify/Firestore mapping | REQUIRES_CHANGE | Keep financial and operational truth separate. |
| inspection_requests | Firestore inspectionRequests | VERIFIED | Retain intake lifecycle. |
| inspection_jobs | Firestore inspectionJobs | VERIFIED | Retain assignment/readiness snapshot. |
| inspection_templates | Both sources | REQUIRES_CHANGE | Add template kind; preserve domains. |
| inspection_template_versions | Firestore templateVersions | VERIFIED | Retain immutable versions. |
| inspections | ProInspect execution | REQUIRES_CHANGE | Do not merge Strata operational inspections. |
| inspection_sections | Firestore report areas | REQUIRES_CHANGE | Add canonical source-version snapshots. |
| observations | Firestore report components | REQUIRES_CHANGE | Add testing/source-version fields. |
| inspection_evidence | Firebase Storage metadata | VERIFIED | Retain ordered links. |
| reports | Firestore reports | VERIFIED | Property inspection reports only. |
| report_versions | Firestore versions/Storage | REQUIRES_CHANGE | Retain complete immutable snapshot hash. |
| maintenance_candidates | Firestore candidates | REQUIRES_CHANGE | Add canonical area/component source IDs. |
| maintenance_items | Firestore items | VERIFIED | Keep distinct from Strata defect. |
| maintenance_quotes | Firestore maintenanceQuotes | VERIFIED | Client-facing quote. |
| maintenance_estimates | Firestore estimates | VERIFIED | Retain estimate lifecycle. |
| maintenance_approvals | Firestore maintenance approvals | REQUIRES_CHANGE | Do not absorb generic Strata approval. |
| maintenance_work_orders | Firestore | VERIFIED | Retain ProInspect work order; Strata operational work orders are separate. |
| maintenance_variations | Firestore variations | VERIFIED | Retain. |
| preventive_maintenance | Firestore schedules | VERIFIED | Retain ProInspect schedule. |
| warranty_claims | Firestore warrantyClaims | VERIFIED | Retain. |
| contractor_quote_requests | Firestore requests | VERIFIED | Retain solicitation. |
| contractor_quotes | Firestore contractorQuotes | VERIFIED | Retain vendor response. |
| work_requests | Firestore workRequests | VERIFIED | Retain external work request. |
| tenant_instructions | Firestore tenantInstructions | VERIFIED | Retain tenancy-linked instruction. |
| external_contacts | Firestore externalContacts | VERIFIED | Keep distinct from contractor company/user. |
| daily_activity_logs | D1 daily_activity_logs | REQUIRES_CHANGE | Expand to complete operational form. |
| resident_requests | D1 resident_requests | REQUIRES_CHANGE | Add person/unit/access/defect links. |
| contractor_attendance | D1 contractor_attendance | REQUIRES_CHANGE | Add full sign-in/out and return gates. |
| key_transactions | D1 key_transactions | REQUIRES_CHANGE | Reference key register/attendance. |
| access_devices | D1 access_devices | REQUIRES_CHANGE | Add request/unit/person/programming fields. |
| access_device_history | D1 access_device_history | VERIFIED | Retain append-only history. |
| move_bookings | D1 move_bookings | REQUIRES_CHANGE | Add approval/logistics/inspection gates. |
| resident_onboarding | D1 resident_onboarding | REQUIRES_CHANGE | Add person/occupancy/module acknowledgement. |
| operational_inspections | D1 inspections | REQUIRES_CHANGE | Separate BM lifecycle with checkpoints/results. |
| assets | D1 assets + Firestore property assets | REQUIRES_CHANGE | Preserve source type and asset detail. |
| maintenance_plans | D1 maintenance_plans | VERIFIED | Retain pending convergence decision. |
| waste_events | D1 waste_events | REQUIRES_CHANGE | Add stream/quantity/action/evidence. |
| incidents | D1 incidents | REQUIRES_CHANGE | Add emergency/authority/follow-up/evidence. |
| bylaw_observations | D1 bylaw_observations | REQUIRES_CHANGE | Add decision/outcome/action/evidence. |
| notices | D1 notices | VERIFIED | Retain. |
| communications | D1 communications | REQUIRES_CHANGE | Retain delivery row; do not flatten Firestore threads. |
| handovers | D1 handovers | VERIFIED | Retain. |
| handover_checklist_items | D1 checklist items | VERIFIED | Retain. |
| operational_report_drafts | D1 monthly_report_drafts | REQUIRES_CHANGE | Add month/commentary/snapshot and lock gate. |
| operational_reports | Canonical immutable release | NEW_CANONICAL_ENTITY | Create immutable release snapshot. |
| audit_events | Both sources | REQUIRES_CHANGE | Add actor role/outcome/source timestamp; append only. |
| integration_connections | Firestore connections | VERIFIED | Secret references only. |
| integration_events | Shopify/canonical | NEW_CANONICAL_ENTITY | Deduplicated webhook intake. |
| integration_deliveries | Firestore deliveries | VERIFIED | Retain. |
| integration_exceptions | Firestore exceptions | VERIFIED | Retain redacted errors. |
| integration_outbox | D1/Firestore outboxes | VERIFIED | Retain immutable post-commit delivery. |
| evidence_files | Storage/R2 metadata | NEW_CANONICAL_ENTITY | Scoped checksum/ownership metadata. |
| migration_id_map | Canonical migration control | NEW_CANONICAL_ENTITY | Deterministic ID/checksum ledger. |

Detailed field, identity, order, permission and reconciliation rules are in the source-specific migration matrices. The schema test enforces that this matrix covers the original 67 table IDs exactly.
