# Reports module

The Reports module is the authoritative workflow that converts inspection evidence into reviewed, versioned, issued and permanently auditable statements of property condition.

## Authority rules

- Normal operational reports originate from an Inspection Job. The server binds Property, tenancy, Property layout version, published Template Version and any required immutable baseline.
- Report content is editable only while the canonical lifecycle allows editing. Approved, issued, finalised and archived content cannot be silently rewritten.
- Corrections after issue create a superseding report/version and preserve the original issued record.
- Browser preview is not the final artifact. Finalisation requires a stored PDF and render manifest that match the current immutable Report Version.
- AI may suggest classifications and commentary, but may not overwrite analyst-reviewed or reviewer-approved content. Reviewed content receives a separate suggestion that must be accepted or rejected by a human.
- Working/operational confirmation must be supported by an explicit qualifying test. Photographs alone cannot prove operation.
- Tenant/recipient submissions are separate response records. They never mutate the issued report directly.

## Primary information architecture

The Reports register provides operational views for all reports, assigned work, review, changes requested, ready-to-issue reports, tenant response, finalisation and archive.

Each Report Console exposes:

1. Overview
2. Inspection
3. Quality Control
4. AI and Review
5. Comparison
6. Tenant Response
7. Maintenance
8. Distribution
9. Versions
10. Final Documents
11. Audit

Visual report composition and bespoke branded layout are deliberately outside this module enhancement and can be changed later without weakening report authority.

## Report creation

Operational reports are created through the Inspection Job create-report command. That command:

- validates the agency, Job, Property and tenancy;
- creates a deterministic report identity;
- binds the active Property Layout Version;
- binds the latest eligible published Template Version;
- resolves the Entry baseline for Exit reporting;
- uses reviewed legacy baseline mapping when an authoritative structured Entry baseline does not exist;
- prevents duplicate report creation for the same Inspection Job.

The Reports register does not create independent browser-only operational reports.

## Inspection truth

Every component records condition, cleanliness and, where relevant, operational/test state separately.

Operational test provenance can include:

- tested/not-tested/not-applicable state;
- method;
- pass/fail/inconclusive result;
- tester identity;
- timestamp;
- supporting evidence photo IDs;
- notes.

`operation_confirmed` is invalid unless the component has a passed qualifying test.

## Quality control

The deterministic Report QC engine evaluates administration, evidence, assessment, testing, commentary, comparison, AI review and workflow concerns.

Examples include:

- missing Property, Inspection Job, Layout Version or Template Version;
- missing required Entry baseline;
- missing area overview evidence;
- exception findings without evidence;
- incomplete condition/cleanliness/working/test assessments;
- confirmed operation without a passed test;
- passed tests without method/provenance;
- working/test contradictions;
- replacement recommendations that are not routed to Maintenance;
- cleanliness or condition classifications that contradict commentary;
- low-confidence AI findings awaiting human review;
- unreviewed Entry-to-Exit comparisons.

The UI renders canonical QC and workflow blockers and links users directly to the affected Area/Component.

## Analyst and reviewer workflow

Components support explicit review states and authority provenance.

Analysts can review AI-generated findings. Reviewers can approve independently or request changes. Separation-of-duties rules prevent an assigned inspector or analyst from reviewer-approving their own work.

Review comments may be attached to the whole report, an Area, Component, evidence item or comparison and move through open, resolved and verified states.

## Type-specific behaviour

### Property Condition Report

Entry reporting creates the detailed commencement baseline and requires ordinary component commentary and Area overview evidence.

### Routine Inspection

Routine reporting is exception-focused. Ordinary components do not require the same narrative density as Entry reporting, while exceptions require evidence and specific commentary.

### Exit Inspection

Exit reporting requires an immutable Entry baseline for the same Property/Tenancy or an explicit reviewed legacy mapping workflow. Component comparisons are first-class records, and material or uncertain changes require human confirmation.

### Comparison and Maintenance Follow-Up

Comparison and Maintenance Follow-Up reports remain evidence-based specialised workflows bound to a baseline. Maintenance Follow-Up preserves the original Maintenance finding while collecting fresh current-condition/testing evidence.

## Distribution and recipient response

Distribution is bound to an immutable Report Version. Each recipient record retains recipient identity/role, status, access grant, issue/view/response timing and revocation/expiry information.

Secure recipient access supports acknowledgement and structured responses. Recipient evidence uses the existing verified external-evidence upload pipeline so file identity, storage generation and hash provenance remain controlled.

Responses are reviewed in ProInspect and resolved independently. Where tenant review is required, finalisation remains blocked until the response workflow is resolved.

## Versions, final PDF and archive

Immutable Report Versions retain sequence, lifecycle state, content hash, creator and creation time.

Final PDF generation is allowed only against the current immutable Report Version. The platform stores and verifies:

- Report Version ID;
- PDF object path and Cloud Storage generation;
- PDF SHA-256;
- render-manifest path and SHA-256;
- generation timestamp.

Finalisation is blocked until the stored PDF matches the current immutable version. Archive creation is similarly version-bound and verified before the Report enters `archived`.

## Application connections

### Properties

Reports retain Property identity and exact Property Layout Version. Property History consumes immutable report versions rather than mutable browser drafts.

### Inspection Jobs

Inspection Jobs are the operational source for report creation, assignments, scheduling and workflow context.

### Templates

Each report binds a published immutable Template Version. Future template enhancements can add conditional components and richer evidence rules without changing issued historical reports.

### Maintenance

Approved/immutable reports automatically feed the Maintenance extraction workflow. Maintenance candidates retain exact Report Version, Area, Component and evidence provenance.

### Tenant Follow-Up

Recipient responses and report-related follow-up can feed the Tenant Follow-Up module without changing the issued version.

### Users and security

Inspector, analyst, reviewer and operations permissions are enforced server-side. Material report actions are audited and agency-scoped.

### Settings

Future Settings work will supply branding, distribution defaults, retention and notification policies. Branding should be captured as a Report Version snapshot so later agency changes do not rewrite historical presentation.

## Offline/cloud behaviour

Cloud-configured report operations remain server-authoritative. API failures must not silently create a competing local authoritative report. Unsaved browser state may be retained for retry, while offline field work should use the explicit outbox/conflict-reconciliation architecture.

## Deliberate layout boundary

This enhancement does not prescribe the final visual report layout. The Report data, workflow, versioning, evidence, review and distribution contracts are intentionally separated from presentation so report design can be changed later without destabilising the underlying inspection record.
