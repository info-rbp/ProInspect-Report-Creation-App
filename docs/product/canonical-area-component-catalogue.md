# Canonical Area and Component Catalogue

## Purpose

The canonical catalogue is the stable vocabulary for physical inspection areas and components across ProInspect. Phase 1 introduces the shared data model and a non-destructive migration from the existing residential `pcrStandardAreas` catalogue.

This phase does not replace Property Layout Versions, Report Versions or published Inspection Template Versions. It gives those modules a common identity layer they can reference in subsequent phases.

## Canonical records

### `AreaDefinition`

An Area definition records:

- stable `id` and machine `code`;
- display name and aliases;
- Area category;
- Property and Inspection Type applicability;
- whether the Area is repeatable;
- version, lifecycle status and migration source;
- every retained legacy Area ID; and
- original legacy ordering for exact migration parity.

A canonical Area describes a type of physical Area. A later Property-specific Area instance such as `Bedroom 2` will reference the `bedroom` definition while retaining its own stable Property identity.

### `ComponentDefinition`

A Component definition records:

- stable `id` and machine `code`;
- display name and aliases;
- Component category;
- Property and Inspection Type applicability;
- version, lifecycle status and migration source; and
- every retained legacy Component ID.

Safe legacy synonyms may resolve to one canonical Component identity. The original IDs remain mapped and are never discarded.

### `AreaComponentRule`

An Area-Component rule records the membership of a Component within an Area:

- Area definition;
- Component definition;
- stable rule ID and code;
- component order;
- inclusion state;
- legacy `required` behaviour;
- legacy `photoRequired` behaviour;
- applicability; and
- the exact legacy Area/Component IDs and names used by existing Reports.

Phase 1 maps `required: true` to `inclusion: required` and `required: false` to `inclusion: default`. Richer optional/conditional, field, evidence and testing policies are intentionally reserved for later phases.

## Version and status

The initial migration creates version `1` records in `published` state with source `legacy_pcr_standard_areas`.

The data model supports the catalogue lifecycle:

- `draft`
- `published`
- `retired`

The Phase 1 migration snapshot is deliberately immutable in meaning. Future catalogue administration will create later versions rather than repurposing identities already referenced by reports.

## Legacy compatibility

`CANONICAL_PCR_CATALOGUE_V1` is generated from the existing `pcrStandardAreas` structure.

The migration guarantees:

1. every legacy Area ID maps to a canonical Area definition;
2. every legacy Component ID maps to a canonical Component definition;
3. every legacy Area/Component membership maps to an Area-Component rule;
4. original Area and Component names are retained on migration rules;
5. original ordering is retained;
6. existing `required` and `photoRequired` flags are retained; and
7. reconstructing legacy Template Areas from the canonical snapshot produces the exact original `pcrStandardAreas` payload.

These invariants are verified by automated tests. Existing Reports therefore retain their historical Area and Component identities while new code gains a canonical lookup layer.

## Safe synonym consolidation

The first migration consolidates only a small set of high-confidence legacy ID variants while retaining both old IDs:

- `light-fitting` -> `light-fittings`
- `smoke-alarms` -> `smoke-alarm`
- `window-screen` -> `windows-screens`
- `bench-top` -> `bench-tops`
- `overhead-cupboard` -> `overhead-cupboards`

Broader semantic consolidation is deliberately not attempted in Phase 1. For example, `floor`, `floor-floorcoverings` and `floor-tiles` remain distinct because treating them as identical could corrupt historical meaning.

## Applicability

The migrated PCR catalogue is residential. Area definitions therefore explicitly record residential Property use and residential physical Property Types. House-only external Areas are narrowed to house-like Property Types rather than being advertised as Apartment Areas.

All five current Inspection Types are represented in the applicability contract:

- Entry
- Routine
- Exit
- Comparison
- Maintenance / Follow-Up

Future catalogue versions can add commercial, retail, industrial and strata/common-property definitions without changing the identity of the migrated residential records.

## Categories

Phase 1 gives every Area and Component a canonical category.

Area categories include circulation, living, sleeping, wet area, kitchen, service, storage, external and safety, with extension points for commercial, industrial and common property.

Component categories include building fabric, door/access, electrical, plumbing, appliance, joinery, flooring, windows/glazing, HVAC, safety/security, external/site, storage, observation and other.

Categories are operational metadata. They do not replace the stable definition IDs.

## Package API

The catalogue is exported through:

`@pcr/templates/canonicalCatalogue`

Primary exports include:

- `CANONICAL_PCR_CATALOGUE_V1`
- `CANONICAL_AREA_DEFINITIONS`
- `CANONICAL_COMPONENT_DEFINITIONS`
- `CANONICAL_AREA_COMPONENT_RULES`
- `LEGACY_CATALOGUE_ID_MAP`
- `migrateLegacyPcrStandardAreas()`
- `validateCanonicalCatalogue()`
- `legacyTemplateAreasFromCatalogue()`
- `findAreaDefinition()`
- `findComponentDefinition()`
- `areaComponentRulesForArea()`

## Authority boundary for Phase 1

The existing `pcrStandardAreas` export remains unchanged and is still consumed by existing Report seeding, historical extraction and Template screens. Phase 1 intentionally does not switch those consumers yet.

This avoids a high-risk big-bang migration. The next phases can move Properties, Templates, Reports, Historical Report Intelligence and Maintenance onto canonical references one boundary at a time while the parity tests guarantee backwards compatibility.

## Next phases

The canonical model is the prerequisite for:

1. Catalogue administration UI and server persistence;
2. Property Layout integration using canonical Area types and Component types;
3. Report Template composition using Area-Component rules rather than cloned hardcoded arrays;
4. server-authoritative Report structure resolution; and
5. cross-module canonical identities for historical imports, comparison, QC, Maintenance and pricing.
