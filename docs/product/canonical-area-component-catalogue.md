# Canonical Area and Component Catalogue

## Purpose

The canonical catalogue is the stable vocabulary for physical inspection Areas and Components across ProInspect. It now provides both the non-destructive canonical identity model and the server-backed administration workflow used from **Templates & Rules -> Areas & Components Catalogue**.

The catalogue does not replace Property Layout Versions, Report Versions or published Inspection Template Versions. Those modules retain their own immutable snapshots. The catalogue provides the shared definitions and versioned rules those modules can progressively reference.

## Canonical records

### `AreaDefinition`

An Area definition records:

- stable `id` and machine `code`;
- display name, description and aliases;
- Area category;
- Property and Inspection Type applicability;
- whether the Area is repeatable;
- version and lifecycle state;
- system/agency source metadata; and
- retained legacy IDs for historical compatibility.

An Area definition describes a type. A later Property-specific Area instance such as `Bedroom 2` can reference the canonical `bedroom` definition while retaining its own stable Property identity.

### `ComponentDefinition`

A Component definition records:

- stable `id` and machine `code`;
- display name, description and aliases;
- Component category;
- Property and Inspection Type applicability;
- operational/testable/repeatable characteristics;
- optional Maintenance category and default trade metadata;
- version and lifecycle state; and
- retained legacy IDs.

Safe legacy synonyms may resolve to one canonical Component identity. Original IDs remain mapped and are never discarded.

### `AreaComponentRule`

Area-Component membership is independent of the Component definition itself. A managed rule records:

- exact Area definition and version context;
- exact Component definition and version;
- stable rule ID and code;
- order;
- inclusion state: `required`, `default`, `optional` or `conditional`;
- assessment defaults;
- evidence defaults;
- applicability; and
- retained legacy Area/Component identifiers and names.

This means one Component such as `oven-griller` can be reused consistently while different Areas or future Template families apply different inspection requirements.

## Assessment defaults

Each Area-Component assignment can configure whether the following fields are `required`, `optional` or `hidden`:

- condition;
- cleanliness;
- material;
- colour/finish;
- type;
- quantity; and
- working status.

It can also configure:

- operational testing as `required`, `recommended`, `optional` or `not_applicable`;
- commentary as `always`, `exception_only`, `optional` or `hidden`; and
- whether the Component is evaluated for Maintenance.

Operational Component categories receive safe defaults that require a working-status assessment and recommend an operational test. Static Components default those fields to non-applicable/hidden behaviour.

## Evidence defaults

Each Area-Component assignment can configure:

- whether a Component photograph is required;
- whether exception evidence is required;
- whether contextual evidence is required;
- minimum normal-photo count;
- minimum exception-photo count;
- whether paired comparison evidence is required; and
- whether a reason is required when evidence cannot be supplied.

The original `photoRequired` flag remains preserved for legacy parity and is synchronised with the managed Component-photo requirement.

## Version and lifecycle

Area and Component definitions use the lifecycle:

- `draft`
- `published`
- `retired`

Published and retired versions are immutable. Changes are made by duplicating an existing version to the next draft version, editing the draft, validating it and publishing it.

Logical published pointers are maintained separately from immutable version records. Retiring the current published version falls back to the previous published version where one exists. Otherwise the logical pointer remains explicitly retired.

Stable IDs are never repurposed. A new concept requires a new stable ID.

## Server-backed administration

The administration API is mounted under:

- `/api/v1/catalogue/areas`
- `/api/v1/catalogue/components`

Supported operations include:

- list/search/filter versions;
- create a new draft definition;
- read an exact version;
- edit an exact draft using optimistic record-version locking;
- duplicate any version into the next draft version;
- publish a draft;
- retire a published version; and
- calculate direct usage impact before retirement.

All mutations require `template.manage`, use idempotency keys, apply optimistic concurrency and write audit events.

## Catalogue administration UI

The previous read-only Areas & Components tab has been replaced by a genuine editor inside **Templates & Rules**.

The UI supports:

- switching between Areas and Components;
- search by name, ID, code or alias;
- filtering by lifecycle status and category;
- creating Area and Component drafts;
- editing draft metadata and applicability;
- duplicating published/retired definitions;
- publishing validated drafts;
- retiring published definitions with usage acknowledgement;
- assigning published Components to draft Areas;
- removing and reordering Component assignments;
- configuring `required/default/optional/conditional` inclusion;
- configuring assessment defaults;
- configuring evidence defaults; and
- viewing usage-impact counts.

The screen also exposes system-foundation records distinctly from agency-created definitions.

## Usage impact and retirement safety

Before retirement the server can count direct canonical references across:

- other catalogue Areas, for Component usage;
- Inspection Template Versions;
- Properties;
- Reports; and
- Maintenance Items.

Published dependencies are flagged separately. If direct references exist, retirement requires explicit acknowledgement. Retirement never rewrites historical records or immutable published versions.

The current impact model intentionally counts direct canonical IDs/codes and retained legacy IDs rather than fuzzy names. This avoids presenting speculative matches as authoritative dependencies. Property/report coverage will become richer as those modules adopt canonical references in subsequent phases.

## Initial catalogue seeding

The first agency access seeds the existing canonical residential PCR definitions into immutable version `1` records with `published` state and `systemDefault` metadata. Seeding is idempotent and does not overwrite later agency lifecycle decisions.

The managed catalogue therefore begins with the same report-facing structure as the historic `pcrStandardAreas` source while gaining persistent administration records.

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

These invariants are covered by automated tests. Existing Reports therefore retain their historical identities while new catalogue versions can evolve independently.

## Safe synonym consolidation

The initial migration consolidates only high-confidence legacy ID variants while retaining the original IDs:

- `light-fitting` -> `light-fittings`
- `smoke-alarms` -> `smoke-alarm`
- `window-screen` -> `windows-screens`
- `bench-top` -> `bench-tops`
- `overhead-cupboard` -> `overhead-cupboards`

Broader semantic consolidation is deliberately not automatic. For example, `floor`, `floor-floorcoverings` and `floor-tiles` remain distinct because treating them as identical could corrupt historical meaning.

## Applicability

Definitions explicitly record:

- Property Uses;
- Physical Property Types; and
- Inspection Types.

The migrated PCR catalogue starts with residential applicability. The administration model is already capable of agency-created commercial, retail, industrial, mixed-use and strata/common-property definitions without changing the identity of residential records.

All five current Inspection Types are supported:

- Entry;
- Routine;
- Exit;
- Comparison; and
- Maintenance / Follow-Up.

## Categories

Area categories include circulation, living, sleeping, wet area, kitchen, service, storage, external and safety, plus commercial, industrial, common-property and other extension categories.

Component categories include building fabric, door/access, electrical, plumbing, appliance, joinery, flooring, windows/glazing, HVAC, safety/security, external/site, storage, observation and other.

Categories are operational metadata. They never replace stable IDs.

## Package APIs

Canonical migration and lookup contracts are exported through:

`@pcr/templates/canonicalCatalogue`

Administration contracts and policy helpers are exported through:

`@pcr/templates/catalogueAdmin`

The administration package exports managed Area/Component/version views, assessment/evidence policy contracts, draft creation helpers, ordering helpers and validators used by both API and browser layers.

## Authority boundaries

1. Catalogue definitions may evolve by version.
2. Published and retired catalogue versions are immutable.
3. Property-specific physical Area identity remains separate from canonical Area type identity.
4. Published Inspection Template Versions and Reports remain immutable snapshots.
5. Retiring a catalogue definition affects future selection, not historical truth.
6. Existing `pcrStandardAreas` consumers remain supported until their module is deliberately migrated.
7. A draft Area may only assign an exact published Component version.
8. A draft Area cannot be published if one of its assigned Component versions is no longer published.
9. Usage impact is advisory plus an explicit retirement safeguard, not permission to mutate downstream records.

## Remaining integration phases

With the identity model and administration layer complete, the next catalogue phases are:

1. Property Layout integration using canonical Area and Component references;
2. Report Template composition using catalogue rules instead of cloned hardcoded arrays;
3. server-authoritative Report structure resolution; and
4. cross-module canonical identities for Historical Report Intelligence, comparison, QC, Maintenance and pricing.
