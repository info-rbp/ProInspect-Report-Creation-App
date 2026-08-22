# ADR: Financial and licensing boundary

## Status
Accepted

## Decision

ProInspect is an operational property inspection, evidence, reporting, tenancy-document, communications, maintenance-coordination and compliance platform. It is not a trust-accounting, payments or financial-ledger product.

ProInspect may record commercial facts needed to make operational decisions, including quote values, estimates, approval limits, budgets, service prices, GST-inclusive totals and external financial status references.

ProInspect must not:

- receive, hold, transfer, allocate or disburse money;
- process rent or bond money;
- maintain a trust ledger, rent ledger or general ledger;
- reconcile bank accounts or trust accounts;
- create payment transactions;
- create accounting invoices or accounting purchase orders as an authoritative financial action;
- expose pay-now, payout, disbursement or reconciliation controls;
- become the source of truth for arrears balances, trust balances or owner statements.

External PMS/accounting systems remain authoritative for money, banking, trust accounting, rent, arrears, bond transactions, invoices, payments, receipts, disbursements and reconciliation.

## Integration rule

ProInspect may exchange identifiers, workflow events and coarse external statuses such as `rent_status`, `bond_status` or `invoice_status` when required for an operational decision. It must not import transaction ledgers merely to recreate accounting behaviour.

## Enforcement

New APIs, capabilities and UI actions must be reviewed against this ADR. Commercial workflow names should use `commercial`, `quote`, `approval`, `work_order` or `external_status` rather than `billing`, `finance`, `payment` or `trust` unless the field is explicitly a read-only external reference.
