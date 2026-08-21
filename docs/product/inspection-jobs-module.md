# ProInspect Inspection Jobs and Operations Module

## Purpose

Inspection Jobs is the operational command centre between commercial demand, appointment booking, the permanent Property record, field inspection and the controlled report lifecycle.

The module deliberately distinguishes an **Inspection Request** from an **Inspection Job**.

- An Inspection Request is an intake record received from Shopify, Google Calendar, a property, maintenance, a recurring schedule, an API or a staff member.
- An Inspection Job is authorised operational work against one canonical ProInspect property.

This distinction prevents an unpaid order, an unmatched address or an incomplete appointment from becoming a misleading operational job.

## Authority model

| Information | Authoritative system |
| --- | --- |
| Customer order, payment, refund and cancellation | Shopify |
| Appointment date, time and booking cancellation | Google Calendar |
| Property identity, layout, access and historical context | ProInspect Properties |
| Current tenancy | ProInspect Tenancies |
| Inspector/reviewer assignment | ProInspect |
| Inspection lifecycle and workflow gates | ProInspect |
| Evidence, assessment, commentary and report | ProInspect |
| Final PDF and archive | ProInspect |

External systems may update commercial and booking facts. They never bypass ProInspect inspection, review, issue, finalisation or archive gates.

## Navigation

The Inspection Operations workspace contains:

1. Jobs
2. Intake Queue
3. Schedule
4. Assignment
5. Recurring
6. Sync & Exceptions

The Job Detail route combines the existing server-authoritative workflow console with operational order, booking, readiness, access and communication panels.

## Inspection request lifecycle

An intake record can move through:

`received -> awaiting_payment -> awaiting_booking -> awaiting_property -> ready_for_job -> converted`

Exception outcomes are:

- `needs_review`
- `duplicate`
- `cancelled`
- `failed`

Payment, booking and property matching remain independent dimensions. For example, a Shopify order can be paid while still awaiting a Google appointment and property match.

## Intake sources

Supported sources are:

- Shopify
- Google Calendar
- Manual
- Property
- Maintenance
- Recurring schedule
- API

Each source retains its external identity. Provider identifiers are references and are never used as the canonical ProInspect primary key.

## Property matching

Inbound addresses are normalised and compared to canonical Property records. Matching uses:

- unit/address normalisation;
- street suffix normalisation;
- postcode and suburb tokens;
- exact and containment matching;
- ranked similarity candidates.

A high-confidence unambiguous result may be linked automatically. Ambiguous or missing matches remain in the Intake Queue for human review. External intake never silently creates a duplicate property.

Where no suitable property exists, the operator uses the existing Property onboarding workflow before linking the request.

## Request-to-job conversion

Conversion is deterministic and replay safe.

A request must have:

- a mapped inspection type;
- a canonical property;
- satisfied payment requirements;
- a confirmed or explicitly exempt booking;
- no cancellation, duplication or failure state.

Conversion creates a server-authoritative Inspection Job and records:

- request/source identity;
- commercial state;
- booking state;
- property match state;
- priority;
- duration and timezone;
- Shopify order reference where applicable;
- Google Calendar reference where applicable;
- property layout/access/alert snapshot;
- active tenancy where available.

The request is then linked to the job and marked `converted`. Replaying the command returns the existing deterministic job rather than creating another.

## Property snapshot

The job captures the operational property context that existed at creation:

- stable property ID;
- exact property layout version;
- address;
- property use and physical type;
- ownership/strata structure;
- access instructions;
- active property alerts;
- tenancy reference;
- snapshot timestamp.

This snapshot does not replace the live Property record. It preserves what the field team was told when the work was booked.

## Job readiness

The pre-inspection readiness model evaluates:

- property matched;
- property layout available;
- payment satisfied;
- appointment confirmed;
- active tenancy resolved where required;
- inspector assigned;
- reviewer assigned;
- access ready;
- Entry baseline available for Exit inspections;
- report template assigned.

The UI presents every gate and blocker. The readiness model supplements rather than replaces the existing report-content and lifecycle gates.

## Job views

### List

Detailed operational view including source, order, appointment, team, access, readiness, SLA and report actions.

### Kanban

Operational columns for planning, field inspection, AI/review, approval/issue, finalisation and exceptions.

### Calendar

Day-grouped schedule showing time, property, inspection type, inspector and workflow status.

### Assignment

Unassigned work can be assigned from the active user directory. Optional ranking considers:

- inspection-type capability;
- property-use capability;
- service area;
- scheduled-day workload;
- daily capacity.

The final assignment remains a human decision.

## Scheduling and operational events

Structured operational events support:

- reschedule requested;
- rescheduled;
- customer or agency cancellation;
- inspector unavailable;
- unable to access;
- keys unavailable;
- tenant not present;
- unsafe property;
- weather interruption;
- no-show;
- partial inspection;
- follow-up required.

The original and replacement appointment can be recorded independently of the core report lifecycle.

## Communications

The module records inspection communications such as:

- order received;
- payment confirmed;
- booking link sent;
- booking confirmed/rescheduled/cancelled;
- tenant notice;
- access confirmation;
- inspector/reviewer assignment;
- reminder;
- inspection completion;
- report issue.

A communication can be an evidential log entry or a queued notification task. Provider delivery remains separate from the source inspection record.

## Recurring inspections

Recurring schedules support:

- monthly;
- quarterly;
- six-monthly;
- annual;
- custom-day cadence.

Schedules store next due date, booking lead time, notice lead time, default staff, pause state and automation preferences.

A schedule materialises one intake request when it enters the booking lead window. It does not pre-create years of speculative jobs.

## Shopify connection

Shopify creates commercial intake. The integration uses:

- server-held encrypted Admin API credentials;
- GraphQL Admin API reconciliation;
- HMAC-verified webhooks;
- delivery-ID deduplication;
- product/variant/SKU service mappings;
- payment/refund/cancellation state;
- address and access extraction;
- deterministic request creation;
- scheduled reconciliation for missed events.

Configured webhook topics are:

- orders/create;
- orders/paid;
- orders/updated;
- orders/cancelled;
- refunds/create.

Shopify cancellation handling depends on job progress. Draft/booked work can be cancelled safely. Assigned work requires review. A cancellation after field work begins never erases the operational or evidential record and raises a sync exception.

## Google Calendar connection

Google Calendar is the appointment authority. The integration provides:

- OAuth 2.0 connection;
- encrypted refresh-token storage;
- selectable booking calendar;
- stored appointment-schedule booking-page URLs;
- incremental event sync tokens;
- expiring event watch channels;
- watch renewal;
- event creation/update/cancellation;
- deterministic event IDs for ProInspect-created appointments;
- private event metadata linking agency, request, job and Shopify order;
- reschedule/cancellation conflict controls;
- scheduled reconciliation for missed notifications.

Calendar watch notifications do not contain event details. The API responds by running an incremental event sync.

## Combined order and booking automation

The preferred customer flow is:

`Shopify order -> Inspection Request -> booking page -> Google event -> property match -> Inspection Job`

Shopify and Calendar records are merged using, in order:

1. explicit Shopify order number from the booking form;
2. existing event reference;
3. customer email where only one eligible unmatched order exists;
4. manual operator review.

An order without a booking remains `awaiting_booking`. A booking without an order can remain a Calendar-sourced request where payment is not required, or become a sync exception when a paid Shopify service is expected.

## Sync exceptions

The Sync & Exceptions area covers:

- unmapped products;
- payment discrepancies;
- missing customer details;
- unmatched/ambiguous properties;
- booking without order;
- order without booking;
- cancelled order with active job;
- deleted Calendar event;
- Calendar/job date conflict;
- expired watch;
- revoked OAuth;
- expired sync token;
- permission failure;
- provider failure.

Exceptions are resolved or explicitly ignored with an operator resolution record.

## Automation runner

The automation command can:

- materialise recurring inspection requests;
- calculate job SLA status;
- queue reminders for upcoming work;
- record an auditable completion summary.

Production scheduling should call this command through a private authenticated Cloud Scheduler/Cloud Run path using the automation secret.

## Connections to the wider application

### Properties

The Property record provides identity, current layout, access instructions, persistent alerts and tenancy context.

### Reports

All report creation uses the existing server-authoritative job-to-report command. The Jobs queue no longer creates browser-authoritative report records.

### Maintenance

Maintenance Follow-Up requests can flow into the same intake/job model and use the canonical Maintenance and Follow-Up report type.

### Tenant Follow-Up

Access requests and missing-information activity can be recorded as job communications and later linked to Tenant Follow-Up workflows without rewriting inspection evidence.

### Users

Inspector and reviewer selection uses active agency users. Hardcoded people and free-text pseudo-identities are not used as the authoritative assignment source.

### Templates

The report creation workflow continues to bind the published template version and exact Property layout version.

### Dashboard

Inspection operations metrics are available to the Dashboard and the dedicated Jobs workspace.

## Data and safety rules

1. A provider event never bypasses workflow gates.
2. External cancellations never delete completed field evidence or reports.
3. Payment and booking state are independent.
4. External events are idempotent and auditable.
5. Secrets are encrypted server-side and never returned to the browser.
6. Property matching never silently creates duplicate properties.
7. Job scheduling changes after field work begins require review.
8. Shopify remains payment authority; Google Calendar remains appointment authority.
9. ProInspect remains the inspection, evidence, review and finalisation authority.
10. The exact Property layout version is preserved with the job/report.
