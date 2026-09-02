# Strata feature parity contract

The standalone Strata application cannot be archived until every capability below has a final status of `COMPLETE`, `RETIRED_WITH_APPROVAL`, `EXTERNAL_BY_DESIGN`, or `BLOCKED_OWNER_INPUT`. `ENGINEERING_INCOMPLETE` is an explicit non-final working status and must never be relabelled as owner-blocked. `FOUNDATION` means the canonical domain/Appwrite entity exists. `APPLICATION` means the unified API and portal route exist. `DATA` means D1/R2 production-shaped records have migrated and reconciled. `E2E` means the workflow has passed role, scope, lifecycle and evidence tests.

| Capability | Canonical destination | Portals | Foundation | Application | Data | E2E |
| --- | --- | --- | --- | --- | --- | --- |
| Daily activity diary | `daily_activity_logs` | Building, Admin | COMPLETE | API route added | PENDING | PENDING |
| Resident requests | `resident_requests` | Resident, Building, Strata | COMPLETE | API route added | PENDING | PENDING |
| Defects | `defects`, optional link to `maintenance_items` | Building, Strata, Contractor | COMPLETE | Lifecycle route added | PENDING | Domain tests added |
| Operational work orders | `operational_work_orders` | Building, Strata, Contractor | COMPLETE | Lifecycle route added | PENDING | Domain tests added |
| Contractor directory | `contractors` | Building, Strata, Contractor | COMPLETE | API route added | PENDING | PENDING |
| Contractor attendance | `contractor_attendance` | Building, Contractor | COMPLETE | Sign-in CRUD and guarded sign-out route added | PENDING | Domain sign-out tests added |
| Controlled-key register | `key_register`, `key_transactions` | Building, Contractor | COMPLETE | API routes added | PENDING | PENDING |
| Access-device requests | `access_device_requests` | Resident, Building, Strata | COMPLETE | Lifecycle route added | PENDING | Domain tests added |
| Access devices/history | `access_devices`, `access_device_history` | Resident, Building, Strata | COMPLETE | API routes added | PENDING | PENDING |
| Move bookings | `move_bookings` | Resident, Building, Strata | COMPLETE | Lifecycle route added | PENDING | Domain closure tests added |
| Resident onboarding | `resident_onboarding`, `occupancies` | Resident, Building | COMPLETE | API route added | PENDING | PENDING |
| Common-area inspections | `operational_inspections`, checkpoints/results | Building, Strata | COMPLETE | API routes added | PENDING | PENDING |
| Assets | `assets` | Building, Strata, Contractor | COMPLETE | API route added | PENDING | PENDING |
| Preventive maintenance | `maintenance_plans`, `service_events` | Building, Strata, Contractor | COMPLETE | API routes added | PENDING | PENDING |
| Waste services/events | `waste_services`, `waste_events` | Building, Strata | COMPLETE | API routes added | PENDING | PENDING |
| Incidents/security | `incidents` | Building, Strata, Resident | COMPLETE | API route added | PENDING | PENDING |
| By-law observations | `bylaw_observations` | Building, Strata | COMPLETE | API route added | PENDING | PENDING |
| Quotes | `operational_quotes` | Building, Strata, Contractor | COMPLETE | API route added | PENDING | PENDING |
| Approvals | `operational_approvals` | Strata, Client, Building | COMPLETE | API route added | PENDING | PENDING |
| Notices | `notices` | Building, Strata, Resident | COMPLETE | API route added | PENDING | PENDING |
| Communications | `communications`, `notifications` | All | COMPLETE | Foundation routes available | PENDING | PENDING |
| Documents/evidence | `documents`, `evidence_files`, Appwrite Storage | All scoped portals | COMPLETE | API foundation available | PENDING | Storage denial suite exists; domain tests pending |
| Monthly report drafts | `operational_report_drafts` | Building, Strata | COMPLETE | API route added | PENDING | PENDING |
| Final monthly reports | `operational_reports` immutable releases | Building, Strata, Client | COMPLETE | Generic mutation blocked; supersession service pending | PENDING | Immutability unit test added |
| Handover | `handovers`, checklist items | Building | COMPLETE | API routes added | PENDING | PENDING |
| Tasks/calendar | `tasks`, `calendar_events` | Role-scoped | COMPLETE | API routes added | PENDING | PENDING |
| Inventory | `inventory_items` | Building | COMPLETE | API route added | PENDING | PENDING |
| Audit | `audit_events` | Admin, Strata | COMPLETE | Appwrite audit adapter added | PENDING | Existing foundation tests; domain extension pending |
| Authentication | Appwrite Auth | All | DEVELOPMENT FOUNDATION COMPLETE | Firebase identity bridge remains active | PENDING | Appwrite lifecycle tests exist; application cutover pending |
| Site/property scope | `site_memberships`, properties, units, occupancies | All | COMPLETE | Unified API policy added | PENDING | Negative route tests pending |
| Portal shell | Seven routes in `apps/web` | All | COMPLETE | Routes and role resolver added | N/A | UI E2E pending |
| Offline drafts | Existing web offline workspace + migrated BM draft behavior | Inspector, Building | PARTIAL | Existing inspection support retained | N/A | BM workflow testing pending |
| Shopify generic services | Service definitions/requests/mappings | Admin, Client, Resident | COMPLETE | Existing integration remains inspection-biased | N/A | Generic routing E2E pending |
| Offers & benefits | Domain model implemented; Appwrite tables pending | Admin, Resident | PARTIAL | Portal navigation present | N/A | PENDING |
| Contractor compliance automation | Domain status model implemented; persisted workflow pending | Admin, Building, Contractor | PARTIAL | Policy helper added | PENDING | Unit tests added |

## Legacy source inventory

The source migration covers all 49 D1 tables:

`access_device_history`, `access_device_requests`, `access_devices`, `approvals`, `assets`, `audit_events`, `buildings`, `bylaw_observations`, `calendar_events`, `communications`, `contractor_attendance`, `contractors`, `daily_activity_logs`, `defect_evidence`, `defects`, `documents`, `form_submissions`, `handover_checklist_items`, `handovers`, `incidents`, `inspection_checkpoints`, `inspection_results`, `inspection_templates`, `inspections`, `integration_outbox`, `inventory_items`, `key_transactions`, `keys_register`, `locations`, `maintenance_plans`, `monthly_report_drafts`, `move_bookings`, `notices`, `notifications`, `occupancies`, `people`, `properties`, `property_operating_settings`, `quotes`, `resident_onboarding`, `resident_requests`, `service_events`, `sessions`, `tasks`, `units`, `users`, `waste_events`, `waste_services`, and `work_orders`.

Legacy `sessions` and password hashes are excluded because credentials are not operational data. Legacy IDs are preserved in `migration_id_map`; D1 property scope becomes site membership; R2 object keys become legacy references on scoped evidence records.

## Required completion evidence

For each migrated capability attach:

1. source and target record counts;
2. deterministic ID and checksum reconciliation;
3. orphan/missing-parent report;
4. positive and negative role/scope tests;
5. lifecycle transition tests;
6. evidence count and checksum validation where applicable;
7. idempotent rerun result;
8. rollback result;
9. portal E2E test;
10. owner approval for any retired behavior.

The final cutover requires D1 and R2 to become read-only, a final delta migration, successful reconciliation, rollback evidence, and confirmation that no production route executes from the standalone Strata runtime.
