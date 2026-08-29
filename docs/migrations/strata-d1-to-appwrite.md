# Strata D1 to Appwrite mapping

Status: **BLOCKED pending source inspection**.

No Building Management/Strata repository or D1 SQL migrations were available locally during this foundation task. Table names and columns must not be invented. The Appwrite schema contains candidate target concepts from the supplied brief—activity logs, resident requests, attendance, keys, access devices, move bookings, onboarding, operational inspections, assets/plans, waste, incidents, by-law observations, notices, communications, handovers, and operational reports—but these are not an approved source mapping.

When the repository is supplied, inventory every migration in order and record source table/column, primary/foreign keys, target table/column, enum/status transform, timestamp timezone, permission scope, legacy ID, direct/merged/separate/obsolete decision, and workflow impact. Proposed semantic merges such as Strata defect → `maintenance_items`, work order → `maintenance_work_orders`, quote → `maintenance_quotes`, and approval → an approval entity require field-by-field proof.
