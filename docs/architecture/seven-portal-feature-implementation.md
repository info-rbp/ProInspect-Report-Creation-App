# Seven-portal feature implementation

## Scope

This implementation completes the repository-side seven-portal application layer on top of the canonical ProInspect API and Appwrite model. Portals are presentation, navigation and permission boundaries over shared domain records. They are not separate applications or data stores.

Routes:

- `/admin`
- `/inspector`
- `/building`
- `/strata`
- `/resident`
- `/client`
- `/contractor`

Every portal also exposes `/:featureSlug` routes. Existing mature ProInspect administration screens are reused where they already implement the required feature. Building Management, Strata, Resident and Contractor features use canonical Appwrite-backed resources through server-authoritative scoped APIs.

## Shared portal architecture

### Entitlements and workspace switching

`portal_entitlements` provides scoped portal grants in addition to the transitional base agency role. The browser loads only the current user's entitlements through `/api/v1/platform/portal-entitlements/me`, validates status/validity windows and derives available workspaces. A person can therefore be a Resident at one site, a Council Member at another and a Client user for a portfolio without additional identities.

The API remains authoritative. Browser navigation does not grant data access.

### Scoped API gateways

Privacy-sensitive views do not use agency-wide list APIs.

`/api/v1/portal-scope/*` enforces:

- Resident identity, occupancy, unit, property and managed-site scope.
- Contractor company, assignment and managed-site scope.
- Inspector assignment scope.
- Building/Strata managed-site scope for residents/users/audit views.

`/api/v1/portal-experience/*` provides explicit participant/experience contracts for Resident conversations, Contractor site access/notifications and site contractor directories.

`/api/v1/portal-operations/*` provides server-owned operational create commands. Actor fields, initial lifecycle states and audit events are stamped by the server rather than accepted from the browser.

### Forms and lifecycle actions

Shared feature definitions bind portal navigation to reusable resources and canonical create fields. Known entitlement context such as managed site, client, property, unit and contractor is injected automatically instead of asking users to type database IDs already known by the platform.

Lifecycle actions use the existing Building Management transition commands. Close-out gates preserve evidence/key/inspection requirements.

## Portal coverage

### Admin Portal

Reuses the mature internal ProInspect application for dashboard, clients, properties/sites, inspections, reports, maintenance, residents/tenancies, contractors, communications, documents, compliance, users/access, integrations and settings. The portal adds a canonical Service Request view and provides links into the existing operational consoles instead of duplicating them.

### Inspector Portal

Provides role-specific entry points for Today, schedule/planner, assignments, inspection execution, evidence, issues, reports, keys/access and sync status. Existing inspection job/report pages are reused for mature workflows. Inspector API reads are assignment-scoped. The existing offline queue/sync foundation remains shared with Building Management.

### Building Management Portal

Provides:

- Today dashboard
- Activity diary
- Quick Forms
- Tasks
- Operational inspections
- Defects and maintenance
- Operational work orders
- Contractors and attendance
- Move/delivery bookings
- Residents and units
- Access devices and keys
- Incidents and security
- By-law observations
- Assets
- Maintenance plans
- Waste operations
- Calendar
- Operational/monthly reports
- Notices
- Handover

Operational create commands stamp authors/reporters and safe initial states server-side. Defects, operational inspections/work orders and operational reports remain distinct from the Property Inspection/Maintenance aggregates where their lifecycle semantics differ.

### Strata Portal

Provides site-scoped:

- Dashboard
- Operational reports
- Quotes and approvals
- Maintenance/defects
- Contractors
- Residents
- Access
- Incidents
- By-laws
- Notices
- Documents
- Users
- Audit

Resident/user/audit and contractor-directory data are resolved through managed-site scoped endpoints rather than agency-wide lists.

### Resident Portal

Provides occupancy/self-scoped:

- Home
- My Property / Unit
- Issues and requests
- Maintenance status
- Inspections
- Move/service bookings
- Access-device/key requests
- Documents
- Conversations/messages
- Building notices
- Offers and benefits
- Household
- Profile

Resident request/move/access creation forces the authenticated user and entitled site/unit/property context. Another resident at the same site cannot read the record merely by knowing an ID or query value.

#### Signing and remote inspections

The existing Tenant Portal grant workflows remain the secure execution channel for electronic signing and remote inspection assignments during the identity migration. The authenticated Resident Portal exposes the underlying inspection/document context, but does not store or reconstruct raw grant tokens. Existing routes remain:

- `/tenant-portal/:grantToken`
- `/tenant-portal/:grantToken/inspection/:assignmentId`
- tokenised document/action flows already issued through tenancy workflows.

This avoids weakening one-time grant security merely to remove an extra navigation hop.

### Client Portal

The persistent Client Portal is now actionable rather than overview-only. It provides:

- authorised portfolio/property overview
- active ServiceDefinition catalogue
- ServiceRequest creation against authorised properties
- appointment request/rescheduling contracts
- inspection/report/maintenance visibility
- persistent conversations
- client-admin quote decisions
- documents/compliance summary

Client property relationships are validated server-side. A scoped `client_admin` portal entitlement can approve for its client account without requiring a globally elevated agency role.

High-value quote approval currently writes the approval row and quote decision through guarded repository operations. Atomic multi-record Appwrite transaction hardening remains part of the separate transaction/audit completion workstream and is not treated as proven by this portal feature pass.

### Contractor Portal

Provides contractor-assignment/company scoped:

- Home
- Assigned work / work orders
- Schedule
- Site access
- Check-in/out
- Quotes
- Evidence/documents
- Compliance
- Company profile
- Notifications

The API overrides spoofed contractor/user identifiers on check-in and exposes only work associated with the authenticated contractor profile. Site access combines approved operating settings with keys currently held by the contractor.

## Security tests added

Focused tests cover:

- active vs inactive/expired/future portal entitlements
- every primary navigation entry resolving to an implementation
- Resident same-site data isolation
- cross-unit Resident denial
- server-owned Resident identity on request creation
- Contractor cross-assignment isolation
- server-owned Contractor identity on check-in
- Building Manager cross-site denial
- Inspector assignment isolation
- Resident conversation participant membership
- server-owned incident/activity actors and initial states
- Client property scope for service requests/bookings
- scoped client-admin quote decision permission

## Files of interest

- `apps/web/pages/portals/PortalWorkspacePage.tsx`
- `apps/web/pages/portals/PortalFeaturePage.tsx`
- `apps/web/services/platform/portalFeatureRegistry.ts`
- `apps/web/services/platform/portalFeatureBindings.ts`
- `apps/web/services/platform/portalFeatureForms.ts`
- `apps/web/services/platform/portalEntitlementService.ts`
- `apps/api/src/backend/portalScopedRoutes.ts`
- `apps/api/src/backend/portalExperienceRoutes.ts`
- `apps/api/src/backend/portalOperationalCreateRoutes.ts`
- `apps/api/src/backend/clientPortalActionRoutes.ts`
- `apps/api/src/backend/clientQuoteDecisionRoutes.ts`
- `apps/api/src/backend/clientPortalCatalogueRoutes.ts`

## Validation boundary

This document records repository implementation, not launch readiness. The portal pass still requires the repository's normal CI/build/type/security suite and authenticated Development E2E against `proinspect-development`. The later transaction/audit hardening workstream must make multi-record approval/finalisation commands atomic before Production cutover.
