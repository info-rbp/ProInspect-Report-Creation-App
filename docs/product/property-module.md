# ProInspect Property Module

## Purpose

The Property module is the permanent digital record of the physical asset. Inspection jobs, reports, evidence, maintenance, tenancy periods and historical documents attach to that record rather than creating disconnected property descriptions.

A property is created once and becomes richer over time. Issued and final reports remain immutable even when the property's current layout, ownership, tenancy or asset configuration later changes.

## Property workspace

The internal Property workspace is organised into nine areas:

1. Overview
2. Layout & Areas
3. Assets & Features
4. Access & Keys
5. Owners & Tenancies
6. Documents & Imports
7. Inspections & Reports
8. Maintenance
9. Property History

Historical Report Intelligence and Interactive Floor Plans extend the property detail workspace without changing the authority of the nine core property sections.

The Property Portfolio provides search, classification filters, ownership filters, occupancy filters, onboarding readiness and bulk onboarding.

## Classification model

Property classification is deliberately multi-dimensional.

- `propertyUse` records the operational use, such as residential, commercial, industrial, retail, mixed use or strata/common property.
- `physicalPropertyType` records the physical form, such as house, apartment, office, shop, warehouse or common property.
- `ownershipStructure` records how the property is owned or managed, such as freehold, strata, survey strata or community title.

The legacy `propertyType` field remains temporarily for backward compatibility with existing records and reports.

### Strata

Strata records may contain scheme, plan, lot, unit, building, strata company/manager, common-property responsibility, exclusive-use areas, parking, storage, by-law and access information. Area records may identify responsibility as lot, common property, exclusive use, shared or unknown.

## Layout model

A property owns its configured layout. Templates are starting points only.

The hierarchical layout model is:

`Site -> Building -> Level -> Area -> Component`

The current browser inspection engine continues to consume `roomsConfig` while `layoutNodes` preserves the richer hierarchy. This keeps existing inspection workflows compatible while allowing the property model to grow.

### Standard layouts

The initial catalogue includes:

- Standard 3 x 2 House
- Standard 4 x 2 House
- 1 x 1 Apartment
- 2 x 2 Apartment
- Furnished Apartment
- Townhouse
- Commercial Office
- Retail Premises
- Warehouse / Industrial
- Strata Common Property

A user can also copy another property's layout. Stable area IDs are regenerated so the new property never shares identity with the source property.

### Layout versions

Every material layout change creates a `PropertyLayoutVersion` snapshot. New inspection reports record the exact `propertyLayoutVersionId` used when the report was created. Later property changes therefore do not rewrite the historical structure of an earlier inspection.

## Property onboarding

Single-property onboarding is guided through:

1. Identity
2. Classification
3. Layout
4. Property configuration
5. Assets and access
6. People and alerts
7. Historical records
8. Review and inspection readiness

A separate reviewed CSV import flow supports portfolio onboarding. CSV candidates are validated before creation and are never silently imported when a required or unsupported classification value is present.

## Documents and historical imports

Property documents are first-class records. They are not ordinary inspection photos and must not be mixed with condition evidence.

Supported source categories include historical Entry, Routine, Exit, comparison and maintenance reports; floor/building plans; property photographs; owner instructions; furnishing and appliance schedules; key schedules; contractor records; quotes/invoices; completion/warranty records; compliance records; manuals; strata plans/by-laws and other physical-property records.

### Cloud upload guarantees

Cloud property-document upload is server authorised and uses a restricted Cloud Storage resumable upload URL.

- original file is SHA-256 hashed by the browser
- server issues an immutable destination with `ifGenerationMatch=0`
- completion checks expected size and object generation
- server re-hashes the uploaded bytes before accepting the source
- the verified SHA-256 and generation are retained with the property document
- a property-document audit event is written

Historical source files are never rewritten during extraction or mapping.

### Historical report intelligence

Verified historical Entry, Routine, Exit, comparison and maintenance report documents can be submitted to the Historical Report Intelligence workflow.

Before model analysis, the server re-verifies the accepted object generation and SHA-256 against the immutable property-document record. The historical source bytes are supplied to the server-side Gemini service together with the property's configured stable area IDs and the canonical PCR component catalogue.

The extraction contract requires the model to:

- extract only information supported by the historical source;
- preserve operation or test wording only when the source explicitly states it;
- avoid tenant liability, causation, negligence, fair-wear-and-tear, compensation and bond-deduction conclusions;
- provide page references where identifiable;
- suggest only supplied property area IDs and canonical component IDs;
- provide mapping confidence and uncertainty; and
- produce review candidates rather than authoritative inspection findings.

The server normalises and validates model output. Unknown area/component IDs are removed, confidence is bounded, duplicate findings are collapsed and prohibited liability language is removed. The source file remains immutable.

The operator then reviews each candidate and may:

- confirm the suggested mapping;
- edit and confirm the mapping;
- reject the finding; or
- leave it requiring further review.

The analysis remains `review_required` while any candidates are unresolved. It becomes `mapped` only after human review accepts at least one finding and no suggested candidates remain. A fully rejected extraction becomes `rejected`. Review decisions are versioned and audited.

This follows the same evidence principle as legacy Entry baseline mapping for Exit inspections: imported prose or an AI suggestion must never silently become a factual inspection observation.

## Interactive floor plans

Uploaded floor-plan and building-plan documents remain property documents. Image plans can additionally be converted into an interactive `PropertyFloorPlanMap`.

A floor-plan map:

- references the immutable source property document;
- records the property layout version against which it was mapped;
- contains graphical hotspots linked only to stable configured property area IDs;
- stores hotspot position and size as percentages so the map remains responsive;
- is independently versioned; and
- is auditable property navigation metadata rather than condition evidence.

An operator can choose an area, click the plan to place a hotspot, resize or reposition the hotspot, add a display label and save the map. If the property's current layout version later differs from the floor-plan map's layout version, the UI warns the operator to review the mapping rather than silently treating it as current.

PDF floor plans remain fully retained as property documents. Graphical hotspots currently require an image plan because the browser map operates against a rendered image surface; PDF plans are not altered or rasterised into new source evidence.

## Assets and access

The Property record supports structured assets with category, brand, model, serial, installation/warranty information, condition/test dates, maintenance and evidence references.

Access devices are individual records with type, quantity, identifier, current status, tenancy link, supplied/returned dates and optional evidence. Legacy key/lockbox/alarm fields remain readable during migration.

## Ownership and tenancy history

Current convenience fields remain for backward compatibility, but the long-term model records ownership and tenancy periods separately. Canonical `Tenancy` records link to the property and new inspections can attach to the active tenancy.

A tenancy change must not rewrite the tenant associated with a historical report.

## Alerts

Persistent property alerts record access, safety, tenant, strata, maintenance or general warnings. When an inspection is created from the Property workspace, active alerts are copied into the inspection job operational context so field staff can see the relevant instruction even if the underlying property alert later changes.

## Connections to other modules

### Inspection Jobs

A property can create Entry, Routine and Exit jobs. The job is linked by stable `propertyId`, and the active tenancy is linked where available.

### Reports

Report creation remains server authoritative. The report is seeded from the property's configured areas/components and records the exact property layout version used to create it.

### Maintenance

The Property workspace lists maintenance records by `propertyId` and links back to the global Maintenance workflow. Component history continues to join immutable report observations to linked maintenance records.

### Property History

The Property workspace presents both:

- immutable component history assembled from report versions and maintenance records; and
- a unified property timeline containing layout versions, documents/imports, reports, jobs and maintenance events.

Historical extraction records and floor-plan maps add structured property context but do not rewrite immutable report history.

## Data authority rules

1. Current property configuration may change.
2. Historical report versions never change because the property changed.
3. A new layout creates a new layout version rather than rewriting the version used by prior reports.
4. Historical source documents remain immutable originals.
5. Imported findings require human review before becoming authoritative structured history.
6. AI extraction can suggest mappings but cannot approve them.
7. Floor-plan hotspots are navigation metadata and cannot prove component condition, cleanliness or operation.
8. Inspection working status remains evidence/test controlled.
9. Maintenance and tenant follow-up do not rewrite the source inspection finding.
10. External integrations added later must map into the canonical Property model rather than introducing provider-specific property identities throughout the application.

## Remaining future extensions

The Property model also retains foundations for persistent property profile photographs and future richer spatial tooling. Future work may add per-inspection floor-plan progress overlays or additional spatial annotations, but those extensions build on the existing `PropertyFloorPlanMap` and property layout identities rather than requiring a second property model.
