# Strata D1 to Appwrite migration matrix

## Source evidence and common rules

Source: Strata-Site `1a1ab340e93f72f7662ba8b8ca8b007e0e519ad9`, migrations `0001` through `0006`, applied in sequence to an empty SQLite database for inspection. The result is 49 source tables, 21 explicit indexes and two triggers. D1 remains authoritative.

Every eligible row uses source key `strata_d1:<table>:<id>`, a deterministic Appwrite ID, `legacySystem=strata_d1`, `legacyId=<id>`, a source checksum, a transformed checksum and `migration_id_map`. Dates are parsed as source UTC unless the field is an explicit local date; report-month boundaries use `Australia/Perth`. Null foreign keys remain null and unresolved required relationships block that row. Source statuses are retained exactly unless a table row below names a transform. Permissions are agency + managed-site scoped; residents additionally require own current occupancy, contractors require assignment/own attendance, and multi-site roles require explicit memberships.

## Complete table matrix

| Seq | D1 source | Appwrite target | Transformation, status and relationships | Permission / reconciliation |
| ---: | --- | --- | --- | --- |
| 1 | `properties` | `managed_sites` | Preserve name/address/timezone/strata plan; split address fields where deterministic. Source property ID becomes site legacy ID. | Agency/site admin; count/checksum/address exception report. |
| 2 | `buildings` | `buildings` | Resolve source property to managed site; preserve name. | Site scoped; parent completeness. |
| 3 | `locations` | `property_areas` + `property_levels` | Map building, level label, location type and name; create deterministic level nodes only when label exists. | Site scoped; building/level orphan counts. |
| 4 | `units` | `units`; optional `properties` | Preserve unit/level/building. An inspectable property row is created only by an approved unit policy. | Site scoped; unique site/unit and optional property map. |
| 5 | `people` | `people` | Preserve contact profile; no role inference. | Own/authorised operations; email normalization exceptions. |
| 6 | `users` | Appwrite Auth + `user_profiles` + memberships | Never import `password_hash`; email/role/scope become invite/reauth plan and memberships. | Block activation until role, scope and MFA tests pass. |
| 7 | `sessions` | none | Active custom sessions are security credentials and are not migrated. | Count as deliberately skipped; force Appwrite authentication. |
| 8 | `occupancies` | `occupancies` | Resolve unit/person/user, role, dates and current flag. | Resident own occupancy; relationship completeness. |
| 9 | `tasks` | `tasks` | Preserve type, entity link, due/priority/assignee/status/completion evidence. | Site/assignee scoped; due/status distribution. |
| 10 | `resident_requests` | `resident_requests` | Preserve person/unit/location/category/urgency/access/contact/status/defect. | Own resident or operational roles; defect link exceptions. |
| 11 | `defects` | `defects` | Preserve source links, risk/priority, responsibility, assignment, quote/due, completion/follow-up/verification and approval fields. Never collapse into maintenance item. | Site roles; lifecycle and follow-up distributions. |
| 12 | `defect_evidence` | `evidence_files` | Each row becomes a defect-owned metadata row; binary copies in R2 matrix. | Defect permission; row/object/checksum parity. |
| 13 | `work_orders` | `operational_work_orders` | Resolve defect/service event/location/asset/contractor; preserve scheduling, impacts, findings, work, report and verification. Keep separate from ProInspect maintenance-item work orders. | Assignment/site scoped; lifecycle/relationship parity. |
| 14 | `contractors` | `contractors` | Preserve company/contact/trade/licence/insurance/compliance/emergency/sites/access fields. | Directory to site operations; no authenticated user implied. |
| 15 | `contractor_attendance` | `contractor_attendance` | Preserve visitor, sign-in/out, unit/area, access item, vehicle, acknowledgement, completion, key return, cleanliness and BM inspection. | Own contractor/operations; outstanding-key exception count. |
| 16 | `keys_register` | `key_register` | Preserve description/location/custody/current holder. | Key-capable site roles only; custody distribution. |
| 17 | `key_transactions` | `key_transactions` | Resolve key and attendance; preserve issue/return actor/time/notes. | Append-only key-capable roles; chronological/custody reconciliation. |
| 18 | `access_device_requests` | `access_device_requests` | Preserve unit/person/type/role/auth/payment/status/appointment/applicant/contact/device/quantity/reason/evidence/date/notes. | Own resident or device managers; status distribution. |
| 19 | `access_devices` | `access_devices` | Resolve request/unit/person; preserve serial/type/status/profile/identity/collection/system/programming/activation/replacement/deactivation. | Device managers; resident own issued device only if policy permits. |
| 20 | `access_device_history` | `access_device_history` | Resolve device; preserve append-only event, actor, time and notes. | Same device scope; event sequence parity. |
| 21 | `move_bookings` | `move_bookings` | Preserve requestor/unit/type/logistics/rules/status/decision, pre/post inspections, damage, return and closure. | Own resident or move managers; status and close-gate checks. |
| 22 | `resident_onboarding` | `resident_onboarding` | Resolve unit/person/occupancy; preserve modules, rules, orientation, questions, acknowledgement and BM notes. | Own resident plus site operations; completion distribution. |
| 23 | `inspection_templates` | `inspection_templates` | Set `templateKind=operational`; preserve code/name/type/status. | Inspection managers/readers; unique source identity. |
| 24 | `inspection_checkpoints` | `operational_inspection_checkpoints` | Resolve template; preserve name/category/sequence/evidence/instructions. | Template permission; sequence completeness. |
| 25 | `inspections` | `operational_inspections` | Resolve site/template/inspector; preserve schedule/start/complete/status/summary. | Assigned inspector and site operations. |
| 26 | `inspection_results` | `operational_inspection_results` | Resolve inspection/checkpoint/location/evidence/defect; preserve result/risk/action/maintenance/follow-up. | Inspection assignment/site roles; result and orphan parity. |
| 27 | `assets` | `assets` | Set source type; resolve location/contractor; preserve manufacturer/model/serial/commission/warranty/criticality/QR. | Site scoped; asset/status parity. |
| 28 | `maintenance_plans` | `maintenance_plans` | Preserve asset/contractor/frequency/scope/evidence/last/next/reminders/status. | Site maintenance roles; next-due parity. |
| 29 | `service_events` | `service_events` | Resolve plan/work order; preserve schedule/completion/status/verifier. | Maintenance assignment/site roles. |
| 30 | `waste_services` | `waste_services` | Preserve stream/day/provider/notes. | Site scoped; stream uniqueness. |
| 31 | `waste_events` | `waste_events` | Preserve type/activity/quantity/condition/unit/action/collection/evidence. | Waste managers; month/type totals. |
| 32 | `incidents` | `incidents` | Preserve category/reporter/severity/risk/actions/emergency/damage/repair/defect/unit/person/witness/CCTV/police/strata/follow-up/resolution/evidence. | Restricted incident roles; status/severity/follow-up parity. |
| 33 | `bylaw_observations` | `bylaw_observations` | Preserve category/observation/location/time/decision/outcome/action/evidence/follow-up. | Create vs decide capabilities remain separate. |
| 34 | `quotes` | `operational_quotes` | Preserve defect/contractor/amount/scope/document/validity/status. Do not merge with client-facing ProInspect quote. | Quote roles; amount/status parity. |
| 35 | `approvals` | `operational_approvals` | Preserve target entity/quote/decision/reason/actor/time. | Approval capability; decision audit parity. |
| 36 | `notices` | `notices` | Preserve site, type/title/content/publish/expiry/status. | Resident-visible only when source state permits. |
| 37 | `communications` | `communications` | Preserve recipient/channel/content/delivery time/status. | Sender/recipient/site scope; delivery distribution. |
| 38 | `documents` | `documents` + `evidence_files` | Preserve title/category/entity/version/visibility/uploader and map R2 object. | Visibility plus site/entity scope; binary checksum. |
| 39 | `inventory_items` | `inventory_items` | Preserve category/quantity/unit/location/reorder/status/notes. | Site operations; quantity/status totals. |
| 40 | `notifications` | `notifications` | Migrate only unread or legally required history; preserve recipient/link/read/sent state. | Recipient only; eligible/skipped/read counts. |
| 41 | `audit_events` | `audit_events` | Preserve actor/role/action/entity/before/after/IP/user-agent/source timestamp. Append only. | Audit readers only; exact eligible count/checksum. |
| 42 | `calendar_events` | `calendar_events` | Preserve type/link/title/start/end/all-day/details. | Site scoped; range/status counts. |
| 43 | `handovers` | `handovers` | Preserve from/to/time/summary/status. | Handover roles; count/checksum. |
| 44 | `handover_checklist_items` | `handover_checklist_items` | Resolve handover; preserve title/status/completion/notes. | Parent scope; orphan/completion parity. |
| 45 | `daily_activity_logs` | `daily_activity_logs` | Preserve full form, location/unit/contractor/follow-up/priority/time/evidence/source/audit metadata. | Activity-capable site roles; category/month totals. |
| 46 | `form_submissions` | `form_submissions` | Preserve form/schema/entity/client id/payload/submitter/time for statutory/idempotency history. | Entity/site scope; unique client-submission reconciliation. |
| 47 | `integration_outbox` | `integration_outbox` | Migrate only pending/retryable cutover-window work; preserve immutable payload/dedupe/status/attempt/error/external ref. | Integration workers only; no duplicate delivery. |
| 48 | `monthly_report_drafts` | `operational_report_drafts` + `operational_reports` | Draft remains editable until finalised. A finalised source row creates an immutable release snapshot/hash; later correction supersedes. | Report roles; month uniqueness and snapshot hash parity. |
| 49 | `property_operating_settings` | `property_operating_settings` | Preserve move, contractor, access, onboarding and waste instructions per site. | Site managers; one row per site. |

## Database guarantees and sequence

The D1 triggers `trg_monthly_report_drafts_lock_update` and `trg_monthly_report_drafts_lock_delete` raise `FINALISED_REPORT_LOCKED`. Appwrite cannot express this trigger, so the API must reject update/delete of finalised drafts/releases, create superseding versions only, and audit the action. Server keys are not a bypass justification.

Migration sequence is: site structure (1-4), people/identity plans (5-8), contractors/keys/devices (14-20), resident/moves (10, 21-22), defects/work (9, 11-13, 34-35), inspections/assets/maintenance/waste (23-31), incidents/by-laws/content (32-44), operational capture/outbox/reports/settings (45-49). Each stage is dry-run, relationship validation, Development import, source/target counts and checksums, permission tests, then cleanup/rollback by `migration_id_map` if needed.
