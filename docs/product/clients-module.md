# Clients Module

## Purpose

Clients is the authoritative account layer between a physical Property and the people or organisations that engage ProInspect, receive reports, approve maintenance and agree commercial terms for services.

The module deliberately separates those concepts. An owner, managing agent, engaging client, commercial recipient, report recipient and maintenance approver may be different people or entities.

ProInspect records operational commercial metadata such as quoted amounts, approval limits, invoice-recipient details, payment terms and purchase-order references. It does not receive, hold, transfer, reconcile or disburse money and does not provide trust accounting or a financial ledger.

```text
Client Account
    ├── Contacts & Team
    ├── Engagements & Services
    ├── Commercial Terms
    ├── Inspection Preferences
    ├── Maintenance Approval Policy
    ├── Documents & Agreements
    └── Portal Users
             │
             ▼
Property–Client Relationships
             │
             ▼
Property
    ├── Inspection Requests
    ├── Inspection Jobs
    ├── Reports
    ├── Maintenance
    └── Tenant Follow-Up
```

## Client Account types

Supported account types are:

- Private Landlord
- Property Management Firm
- Commercial Property Owner
- Strata / Owners Corporation
- Strata Manager
- Corporate Client
- Other

The account lifecycle is:

```text
Prospect → Onboarding → Active → On Hold → Offboarding → Inactive → Archived
```

Historical accounts and relationships are never deleted merely because the commercial relationship ends.

## Client Contacts

Contacts are individual people or functional recipients inside a Client Account. Supported roles include Principal, Property Manager, Assistant Property Manager, Portfolio Manager, Maintenance Manager, Accounts, Operations, Owner/Landlord, Owner Representative and Strata Manager.

Contacts may independently be marked as:

- primary contact
- report recipient
- maintenance contact
- accounts/contact recipient
- emergency contact
- maintenance approver

This means a Property Management Firm with many staff remains one Client Account with multiple contacts rather than becoming one account per employee.

## Property–Client relationships

A Property may have multiple current and historical Client relationships:

- owner
- managing agent
- engaging client
- commercial recipient
- report recipient
- maintenance authority
- strata manager
- owner representative

Each relationship has effective dates and may point to a Property-specific primary contact, engagement and delegated maintenance limit.

The canonical relationship records supersede the earlier pattern of relying only on `Property.landlordDetails` and `Property.clientIds`. Those legacy fields remain readable during migration. The sync service backfills compatibility `clientIds` so existing Maintenance and historical code continues to operate during the transition.

## Client onboarding

The onboarding workspace has ten stages:

1. Identity
2. Contacts
3. Engagement & Services
4. Commercial Terms
5. Operational Preferences
6. Maintenance & Approvals
7. Properties
8. Documents
9. Portal & Permissions
10. Review

Activation requires at minimum:

- legal identity, account type and entity type
- a primary contact with an email or telephone number
- a commercial billing arrangement, used only as service-agreement metadata

Missing engagements, inspection preferences and maintenance policy are surfaced as warnings because agency defaults can still apply.

## Duplicate prevention

Client creation and bulk import compare candidate records with existing accounts using:

- ABN
- ACN
- Shopify Customer ID where applicable
- primary/general email
- normalised legal name
- normalised trading name

High-confidence duplicates are linked to the existing account during bulk import. Ambiguous matches require review rather than silently creating another Client.

## Bulk onboarding

The Clients module accepts XLSX, XLS and CSV portfolio files with up to 5,000 rows per reviewed batch.

The browser parses the spreadsheet into structured rows. The server performs duplicate matching and validates each row during a dry run. Rows can be:

- ready
- linked to an existing Client
- review required
- rejected

The commit action is disabled in the user interface until review-required and rejected rows are resolved.

Rows can include Client identity, contact details, commercial terms, Shopify references, Property IDs, relationship types and maintenance approval limits. Provider-specific accounting identifiers are not part of the canonical Client identity.

## Engagements and services

An Engagement represents why and under what terms ProInspect serves the Client. It is distinct from Property ownership.

Supported service codes include Entry, Routine, Exit, comparison, Maintenance Follow-Up, automatic maintenance identification, automatic pricing, maintenance quoting, contractor coordination and completion verification.

The active engagement can carry contract pricing references, default templates and effective/expiry dates.

## Inspection preferences

Client defaults may define:

- preferred time window
- minimum booking notice
- default appointment duration
- direct booking permission
- tenant notification requirements
- default report templates
- report recipient rules
- Routine frequency
- recurring-inspection automation
- booking instructions

These are defaults rather than mutable historical truth. Inspection Requests and Inspection Jobs snapshot resolved Client context when they are linked or converted.

## Shopify, Google Calendar and PMS connections

When Shopify, Google Calendar or a bounded PMS connection produces or enriches an Inspection Request and the Property is resolved, the intake service resolves the Property's current Client relationships and snapshots:

- Client Account
- active Engagement
- primary contact
- Property Manager
- report recipients
- maintenance approver

That Client snapshot follows the Request into the Inspection Job.

PMS connectors may import operational property, client, tenant and tenancy context and publish operational inspection, report, maintenance and document events. They do not import or execute trust-accounting transactions, payments, receipts, disbursements, bank reconciliations or general-ledger entries.

## Reports

Report creation takes Client identity from the Inspection Job snapshot where available. A Client snapshot is then bound to the Report metadata before approval.

An approved or issued Report does not follow later Client-contact changes. Historical documents continue to identify the Client relationship that existed for that inspection.

## Maintenance approval authority

Maintenance resolution uses the Property's current Client relationships plus Client and Property-level policy.

The hierarchy is:

```text
Agency defaults
    ↓
Client maintenance policy
    ↓
Property-specific relationship override
```

Rules may include:

- Property Manager delegated limit
- landlord approval threshold
- emergency authorisation limit
- second approval threshold
- mandatory owner approval for replacements
- mandatory owner approval for capital works
- mandatory owner approval for cosmetic work
- explicitly preauthorised service codes

The Maintenance Item Console displays the currently resolved Client and approver before the quote is sent.

## Commercial terms and accounting boundary

The Client Account stores service-commercial metadata needed for ProInspect workflows. Supported arrangements include Shopify prepaid, account, per-inspection invoicing, consolidated monthly invoicing and other contracted arrangements.

The profile can retain invoice-recipient email, payment terms, purchase-order requirements and pricing profile because those facts govern approval and service delivery. They are not a transaction ledger.

The connected property-management or accounting system remains authoritative for rent, trust accounting, receipts, payments, disbursements, bank reconciliation, bond financial transactions and general-ledger accounting. ProInspect may publish operational outcomes or references to that system but does not execute the financial transaction.

## Client documents

Client-level documents include:

- engagement agreements
- service agreements
- fee schedules
- terms and conditions
- privacy consent
- authority to act
- maintenance authority
- purchase-order reference documents
- insurance/compliance records
- client instructions
- pricing agreements

Files use resumable Cloud Storage upload with content-type and size restrictions. Completion verifies object size, Cloud Storage generation and SHA-256 before recording the document.

Superseding a document preserves the old record and links the new document instead of overwriting history.

## Portal and access

Client Portal User records are scoped to one Client Account and may optionally be restricted to specific Properties.

Supported permissions are:

- `client.properties.read`
- `client.inspections.create`
- `client.inspections.read`
- `client.reports.read`
- `client.maintenance.read`
- `client.maintenance.approve`
- `client.quotes.approve`
- `client.commercial.read`
- `client.documents.read`
- `client.users.manage`

Internal ProInspect access uses separate server-side capabilities such as `client.read`, `client.manage`, `client.contact.manage`, `client.relationship.manage`, `client.document.manage`, `client.portal.manage` and `client.commercial.manage`.

The portal exposes operational information and commercial approval context. It does not expose trust balances, bank accounts, payment execution or ledger reconciliation.

## Offboarding

Offboarding:

- ends current Property relationships
- revokes Client portal-user records
- prevents the account being treated as active
- synchronises affected Properties
- preserves Inspection Jobs, Reports, Maintenance, documents and historical relationships

## Client merge

Duplicate Client Accounts can be merged into a surviving account. Contacts, Engagements, Property relationships, documents, portal records and timeline events are reassigned. The source account is archived with `mergedIntoClientId` rather than deleted.

## Legacy landlord migration

Properties with only the historical `landlordDetails` structure display a migration control. Migration:

1. checks for a likely duplicate Client
2. creates the canonical Client Account if safe
3. creates the primary owner contact
4. creates the Property owner relationship
5. synchronises Property compatibility references

A strong potential duplicate blocks automatic migration for human review.

## Authority rules

| Fact | Authoritative module |
| --- | --- |
| Client legal/commercial identity | Clients |
| Individual Client people and roles | Client Contacts |
| Commercial engagement | Client Engagement |
| Physical asset | Properties |
| Who owns/manages/engages for a Property | Property–Client Relationship |
| Tenant | Tenancy |
| Operational inspection | Inspection Jobs |
| Inspection facts | Reports |
| Maintenance scope and work | Maintenance |
| Rent, trust accounting, payments and ledgers | Connected PMS/accounting system |
| Store order/payment reference | Shopify |
| Appointment time | Google Calendar |

## Release acceptance

A release candidate must demonstrate:

- Client onboarding creates one account, primary contact and engagement
- duplicate ABN/ACN/approved external IDs do not silently create duplicate accounts
- bulk import dry-run separates ready, duplicate, review and rejected rows
- Property relationships synchronise compatibility Client IDs
- legacy landlord migration refuses strong duplicates
- Shopify/Calendar/PMS Property matching carries Client context into the Request and Job
- Report creation retains a version-bound Client snapshot
- Maintenance resolves the Client and approval authority from Property relationships
- Client commercial metadata does not create or execute financial-ledger transactions
- Client documents pass size, generation and SHA-256 verification
- offboarding ends relationships and revokes access without deleting history
- merged Clients preserve subordinate records and historical auditability
