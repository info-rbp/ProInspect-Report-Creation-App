# Role and Capability Matrix

## Purpose

This document defines the canonical business roles, maps them to the current source-code role values, and establishes the minimum permission rules for the shared inspection platform.

Permissions are always constrained by:

- agency membership
- property and tenancy access
- job assignment
- report lifecycle state
- template policy
- separation-of-duties policy

A visible user-interface control is not an authorisation boundary. The Cloud Run API and data-access rules must enforce every permission.

# 1. Canonical role mapping

| Business role | Current `UserRole` value | Phase 1 interpretation |
| --- | --- | --- |
| Platform administrator | `super_admin` | Technical platform administration across authorised agencies; business-data access is exceptional and audited |
| Agency administrator | `proinspect_admin` | Agency configuration, users, templates, overrides and records administration |
| Operations coordinator | `operations` | Property, tenancy, booking, assignment and workflow coordination |
| Inspector | `inspector` | Assigned field-inspection work and evidence submission |
| Analyst | `analyst` | Evidence review, structured findings, commentary and maintenance validation |
| Reviewer | `reviewer` | Independent report review, change requests and approval |
| Property manager / issuing agent | `proinspect_admin` | Issue, tenant-response decisions and finalisation until a dedicated role is introduced |
| Maintenance coordinator | `operations` | Maintenance validation, assignment and closure until a dedicated role is introduced |
| Tenant | `tenant` | Access only to issued reports linked to the tenant's tenancy |
| Landlord / client | `landlord` | Restricted access to authorised property and report outputs |
| Commerce customer | `shopify_customer` | Order and service-request access only; no implicit report administration rights |

System services such as AI analysis, archive, notification and integration workers are service identities, not human `UserRole` values.

## Planned role separation

Phase 2 should evaluate introducing dedicated code roles for:

- `property_manager`
- `maintenance_coordinator`
- `records_administrator`

Until that decision is implemented, the table above is authoritative. The application must not invent additional role labels in screens, documentation or policies without updating this matrix.

# 2. Capability matrix

Legend:

- **All**: all records within the authorised agency scope
- **Assigned**: only records explicitly assigned to the user
- **Linked**: only records linked to the user's tenancy or client relationship
- **Policy**: permitted only when agency policy enables it
- **No**: not permitted

| Capability | Platform admin | Agency admin | Operations | Inspector | Analyst | Reviewer | Tenant | Landlord |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| View agency settings | Exceptional | All | Read | No | No | No | No | No |
| Edit agency settings | Exceptional | All | No | No | No | No | No | No |
| Invite, suspend and assign users | Exceptional | All | No | No | No | No | No | No |
| View audit events | Exceptional | All | Policy | Own actions | Assigned | Assigned | Own access | Linked issue and delivery events only |
| Create or edit clients | No by default | All | All | No | No | No | No | No |
| Create or edit properties | No by default | All | All | No | No | No | No | No |
| Archive a property | No by default | All | Policy | No | No | No | No | No |
| Create or edit tenancies | No by default | All | All | No | No | No | No | No |
| View property records | Exceptional | All | All | Assigned | Assigned | Assigned | Linked summary | Linked summary |
| Create inspection jobs | No by default | All | All | No | No | No | No | No |
| Assign inspectors and reviewers | No by default | All | All | No | No | No | No | No |
| Reschedule or place a job on hold | No by default | All | All | Request only | No | No | No | No |
| Cancel an inspection job | No by default | All | Policy | No | No | No | No | No |
| Start an inspection | No | Override | Override | Assigned | No | No | No | No |
| Record findings and evidence | No | Override | No | Assigned draft | Assigned review edits | Review comments only | Response evidence only | No |
| Submit field inspection | No | Override | No | Assigned | No | No | No | No |
| Waive missing evidence | No | Policy | No | No | No | Policy | No | No |
| Queue or retry analysis | Technical retry | Policy | Policy | No | Assigned retry | Assigned retry | No | No |
| Edit AI-generated findings | No | Override | No | Before submission | Assigned | Amendment through review | No | No |
| Complete analyst review | No | Override | No | No | Assigned | No | No | No |
| Request report changes | No | Override | No | No | No | Assigned | No | No |
| Approve report | No | Policy override | No | No | No | Assigned | No | No |
| Edit published template | No | Draft only | No | No | No | No | No | No |
| Publish or retire template | No | All | No | No | No | No | No | No |
| Authorise report issue | No | All | No | No | No | No unless policy | No | No |
| View issued report | Exceptional | All | Policy | Assigned historical | Assigned | Assigned | Linked | Linked |
| Download report or evidence | Exceptional and audited | All | Policy | Assigned | Assigned | Assigned | Linked report | Linked report |
| Submit tenant response | No | No | No | No | No | No | Linked | No |
| Respond to tenant changes | No | All | No | No | No | No unless policy | No | No |
| Finalise report | No | All | No | No | No | No unless policy | No | No |
| Create superseding correction | No | Policy with approval | No | No | Prepare amendment | Approval required | No | No |
| Create maintenance item | No | All | All | Suggest | Validate | Validate | Report issue only | Report issue only |
| Assign maintenance action | No | All | All | No | No | No | No | No |
| Close maintenance action | No | All | All with evidence | No | Verify evidence | Policy | No | No |
| Delete draft report | No | Policy | No | Own unsubmitted draft only | No | No | No | No |
| Delete issued or final report | No | No | No | No | No | No | No | No |
| Export personal data | Exceptional and audited | Policy | No | No | No | No | Own data request | Linked data request |

# 3. Separation of duties

The platform must support configurable separation between:

- inspector and reviewer
- analyst and reviewer
- report issuer and reviewer
- correction author and correction approver

At minimum, the same user must not approve their own report when agency policy requires independent review.

# 4. Access-scope rules

## Agency scope

Every business record must include or resolve to an `agencyId`. Cross-agency access is denied unless an explicitly authorised platform-administration process is used and audited.

## Assignment scope

Inspectors, analysts and reviewers receive access through an active assignment. Reassignment must preserve assignment history.

## Tenant scope

A tenant may access only:

- the exact issued report version linked to their tenancy
- their own draft and submitted response
- final outputs explicitly delivered to them

Tenant access does not confer access to other inspections, maintenance records, owner data or agency operations.

## Landlord scope

A landlord may access only properties and reports explicitly linked to their client relationship and released by the agency.

# 5. Lifecycle restrictions

- Draft findings may be edited by permitted operational roles.
- Reviewer-approved versions are immutable snapshots.
- Issued versions are immutable.
- Tenant submissions are immutable after submission unless formally reopened.
- Finalised and archived reports cannot be edited in place.
- Corrections create a superseding version and preserve the original.

# 6. Technical enforcement requirements

The backend must verify:

1. authenticated identity
2. active user status
3. canonical role
4. agency membership
5. property and tenancy scope
6. job assignment where applicable
7. current workflow state
8. requested command permission
9. separation-of-duties policy
10. optimistic-lock version

Every granted override must record the actor, role, reason, previous state and resulting state in an immutable audit event.

# 7. Change control

A role or permission change requires updates to:

- this matrix
- shared domain types
- backend authorisation policy
- Firestore and Storage rules where applicable
- automated permission tests
- user-interface visibility rules
- product documentation

Permission changes must never be implemented only in the frontend.