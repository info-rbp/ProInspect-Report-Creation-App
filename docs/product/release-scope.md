# Release Scope and Product Priorities

## Purpose

This document defines the approved delivery boundary for the Property Condition Report platform. It separates the first production release from capabilities that are required later, preventing the full product vision from being treated as one undifferentiated backlog.

The authoritative product requirements are:

- [Inspection Type Requirements](inspection-types.md)
- [End-to-End Inspection Business Workflow](business-workflow.md)
- [Role and Capability Matrix](role-capability-matrix.md)
- [Phase 1 Completion Record](phase-1-completion.md)

## Delivery principles

1. The product uses one shared inspection engine with versioned configuration for each report type.
2. Google Cloud and Firebase remain the target infrastructure platform.
3. Business evidence is stored as structured data before prose is generated.
4. AI assists inspection analysis but does not approve reports, assign liability or finalise records.
5. Security, agency isolation, auditability and immutable final outputs are launch requirements rather than later hardening work.
6. A feature is not complete merely because a screen or status label exists.

# 1. First production release

The first production release is intended for controlled internal use and a limited agency pilot.

## 1.1 Launch-critical business capabilities

### Identity and agency controls

- authenticated user accounts
- agency-scoped access
- role-based permissions
- user invitation and suspension
- administrator MFA
- immutable audit events for material actions

### Core records

- agencies
- users
- clients and owners
- properties
- tenancies
- inspection jobs
- report versions
- photos and evidence metadata

### Inspection types

The first production release must support:

1. Entry Property Condition Report
2. Routine Inspection Report
3. Exit Inspection Report

The shared domain model must also recognise:

4. Inspection Comparison Report
5. Maintenance and Follow-Up Report

Comparison and Maintenance may be released initially as controlled internal workflows rather than complete customer-facing modules.

### Inspection execution

- job booking and assignment
- mobile-responsive inspection workspace
- area and component assessment
- access limitations
- condition, cleanliness and working-status recording
- photo upload with retry
- local draft recovery
- required-evidence validation

### Commentary and analysis

- server-side Vertex AI processing
- structured AI output
- commentary-bank and template rules
- analyst review
- reviewer approval
- evidence references
- maintenance-candidate extraction

### Report completion

- server-generated PDF
- approved, issued and final report versions
- immutable final artefacts
- report and evidence manifest
- finalisation and archival audit trail

### Operational controls

- role-specific work queues
- visible upload and processing failures
- retry-safe asynchronous processing
- Cloud Logging and Monitoring
- backup and recovery procedures
- CI validation before deployment

## 1.2 Launch-critical report behaviour

### Entry PCR

- full component baseline
- comprehensive evidence
- tenant-response-ready issued version
- final immutable report

### Routine Inspection

- area overview and exception-based component findings
- maintenance and tenant follow-up extraction
- prior issue carry-forward

### Exit Inspection

- final Entry baseline linkage
- component-level Entry-to-Exit comparison
- paired evidence for material differences
- separate cleaning and physical-condition findings
- no automated liability conclusion

## 1.3 Pilot acceptance gates

A controlled production pilot may begin only when:

- cross-agency access tests pass
- the three launch inspection types complete end to end
- required evidence validation prevents incomplete submission
- AI work is executed server-side
- reviewer approval is enforced
- final PDFs are reproducible and immutable
- audit events exist for every material transition
- backup and restore have been tested
- monitoring and incident alerts are operating
- no critical security defect remains open

# 2. Required before external-agency onboarding

The following must be complete before unrelated external agencies are onboarded:

- Identity Platform tenant or equivalent agency isolation model
- agency administrator self-service controls
- agency branding and report configuration
- versioned template publishing
- usage limits and cost controls
- agency-specific retention settings
- support and incident-management procedures
- privacy and data-handling documentation
- onboarding, training and service documentation
- formal production support ownership

# 3. Required before tenant self-service access

- secure expiring invitation links
- tenant identity verification
- exact issued-version access
- component-level agreement and disagreement
- tenant comments and evidence uploads
- draft saving and submission deadline handling
- agent response workflow
- immutable tenant submission
- final report containing tenant and agent records
- tested no-response and extension policies

# 4. Phase 2 capabilities

These are committed next-stage capabilities but are not required to close Phase 1 planning:

- complete Inspection Comparison module
- complete Maintenance and Follow-Up module
- controlled offline inspection package and synchronisation
- tenant review portal
- template editor and publishing interface
- notification service
- server-side workflow command engine
- Cloud Tasks analysis orchestration
- Pub/Sub domain events
- automated archive verification
- role-specific dashboards
- Google Drive import into Cloud Storage

# 5. Later capabilities

These remain outside the initial delivery commitment:

- Shopify order automation
- property-management-system integrations
- landlord self-service portal
- maintenance-contractor portal
- automated billing
- advanced portfolio analytics
- automated trade allocation
- general-purpose public API
- multi-jurisdiction legal-rule automation

# 6. Explicit exclusions

The product must not automatically:

- decide tenant liability
- calculate bond deductions
- determine legal responsibility
- certify an item as working without evidence
- replace specialist building, electrical, plumbing or safety assessment
- infer that a tenant accepted a report merely because no response was received
- modify an issued or final report version in place

# 7. Prioritisation method

Product work is prioritised in this order:

1. security and evidence integrity
2. complete inspection and review workflow
3. reliable final report generation
4. operational efficiency
5. external user experience
6. integrations and analytics

Any proposed feature that delays security, evidence integrity or end-to-end report completion requires explicit product-owner approval.

# 8. Change control

Changes to this scope require:

- a documented proposal
- impact on launch gates
- technical impact
- data-model impact
- security impact
- product-owner approval
- repository change through pull request

The Phase 1 planning baseline is approved in [Phase 1 Completion Record](phase-1-completion.md).