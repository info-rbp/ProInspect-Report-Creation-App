# Report presentation architecture

Report presentation is intentionally separated from inspection truth. Inspection Templates define what must be inspected and evidenced. Report Presentation Templates define how an approved immutable Report Version is communicated.

## Versioned inputs

Every final render is identified by:

- Report Version ID;
- Inspection Template ID and version;
- Report Presentation Template ID and version;
- branding snapshot SHA-256;
- renderer version;
- font-bundle version;
- canonical render-input hash.

Changing presentation code or branding therefore cannot silently reuse an existing immutable render identity.

## Presentation templates

Presentation Templates use draft, published and retired lifecycle states and contain page, typography, cover and ordered section policy. Published presentation versions are intended to be immutable and assigned by exact version.

Supported section types include cover, executive summary, property and inspection detail, key findings, Area findings, comparison, maintenance, tenant response, approval, disclaimer, photo appendix, attachments and audit reference.

## Branding profiles

Branding Profiles are separately versioned so an agency can change its current logo, contact details or visual identity without changing historic reports. A published profile is captured by value into a Report Branding Snapshot before final rendering.

## API storage

The existing agency-scoped generic API exposes version resources at:

- `/api/v1/report-presentation-templates`
- `/api/v1/report-branding-profiles`

Writes use the existing optimistic-version and permission model. Presentation-specific publish workflows should validate with `@pcr/report-presentation` before changing lifecycle state.

## Immutable final artifacts

The PDF render manifest and archive manifest record presentation identity alongside inspection-template identity and the Report Version. Final report files remain content-addressed and immutable.
