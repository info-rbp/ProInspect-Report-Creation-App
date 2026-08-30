# Unified ProInspect platform

## Decision

`ProInspect-Report-Creation-App` is the canonical application repository. The standalone Strata application is a migration source and will be retired after feature parity, data reconciliation, and cutover are proven.

The platform is one application with seven role-specific portals over shared services. A portal is a presentation and permission boundary, not a database or deployment boundary.

## Runtime ownership

| Concern | Authority |
| --- | --- |
| Identity, memberships, operational data, evidence metadata, Storage, row/file permissions | Appwrite |
| Business rules, high-value commands, lifecycle transitions, audit creation | ProInspect API |
| Web experience and seven portals | `apps/web` |
| Catalogue, pricing, checkout, payments, refunds, financial order state | Shopify |
| AI, PDF, document-heavy, notification, dashboard and integration processing | Existing Google Cloud workers, progressively repointed to Appwrite-backed APIs |
| Edge delivery and same-origin `/api` proxy | Existing Cloudflare deployment |

Firebase/Firestore, Firebase Storage, D1 and R2 remain migration sources only until their individual domains are explicitly cut over. Permanent bidirectional synchronisation is prohibited.

## Portals

| Route | Experience | Primary scope |
| --- | --- | --- |
| `/admin` | ProInspect administration and operations | Agency/global |
| `/inspector` | Assigned field inspections | Assigned inspection jobs |
| `/building` | Day-to-day Building Management | Managed site |
| `/strata` | Oversight, approvals and governance | Managed site/scheme |
| `/resident` | Owner/resident/tenant self-service | Site, unit, occupancy |
| `/client` | Portfolio, service, report and approval activity | Client and authorised properties |
| `/contractor` | Assigned work, attendance, evidence and compliance | Contractor and authorised sites |

Tokenised guest experiences for report access, approvals, quotes, signatures and work requests remain separate from permanent portal access.

## Shared domains

- Identity and access
- Agencies and clients
- Managed sites, buildings, levels, units, properties and locations
- People, residents, tenants, tenancies and occupancies
- Service definitions and service requests
- Inspection operations and property reports
- Building Management operational inspections and reports
- Maintenance, defects, quotes, approvals and work orders
- Contractors, attendance and compliance
- Access devices and controlled keys
- Moves, incidents, waste, by-laws and handovers
- Assets, preventive maintenance and service events
- Documents, evidence and immutable versions
- Conversations, notifications and tasks
- Offers and benefits
- Shopify and external integrations
- Audit, migration identity and reconciliation

## Domain boundaries that remain separate

The following concepts can link to one another but must not be flattened because their lifecycles differ:

- Property inspection report vs Building Management monthly report
- ProInspect maintenance item vs Building Management defect
- ProInspect maintenance work order vs operational work order
- Property inspection vs common-area operational inspection
- Person vs portal identity vs tenant vs occupancy
- Shopify financial state vs ProInspect operational state

## Security model

Authorisation is capability plus scope:

1. authenticated identity;
2. active agency membership;
3. active site/client/occupancy/contractor/assignment relationship;
4. role capability;
5. lifecycle and separation-of-duties rule;
6. MFA for privileged roles;
7. server-side audit of allowed and denied material actions.

The UI may hide unavailable actions, but the API remains authoritative.

## Building Management API

Canonical operational resources are exposed below `/api/v1/building/*`. Lifecycle state cannot be patched directly for protected resources. Dedicated commands enforce:

- defect transitions and evidence/verification closure gates;
- operational work-order transitions;
- move booking transitions and return/inspection closure gates;
- access-device request transitions;
- contractor sign-out with controlled-key override rules;
- immutable operational reports that can only be superseded.

`APPWRITE_BACKEND_MODE=foundation` or `appwrite` activates Appwrite operational repositories while legacy report, upload, task and specialist-worker paths remain available during bounded migration.

## Commerce boundary

Shopify products and variants map to `ServiceDefinition` through `shopify_service_mappings`. Paid or otherwise qualifying Shopify events create or update generic `ServiceRequest` and `ServiceRequestItem` records before selecting an inspection, maintenance, access, tenancy-document, leasing/admin, Building Management or Strata workflow.

Every inbound delivery requires HMAC validation, delivery-ID deduplication, idempotent processing, exception recording and reconciliation.

## Deployment principle

The standalone Strata runtime, custom authentication, D1 binding and R2 binding are not imported into the canonical runtime. Their business behavior and data are migrated into the shared domain, API, Appwrite schema and Storage model. The legacy repository is archived only after the parity register is complete and the final D1/R2 delta reconciles.
