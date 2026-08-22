# Report presentation production quality gates

A report-presentation change is not complete merely because a PDF can be opened. The final artifact is a version-bound customer document and must preserve the same authority, reproducibility and evidence provenance as the underlying Report Version.

## Required gates

- identical approved facts and presentation identity produce the same canonical render identity;
- renderer-version changes produce a new render identity;
- presentation-template version changes produce a new render identity;
- branding changes are captured through an immutable branding snapshot/hash;
- long reports paginate without losing PDF validity;
- Routine rendering remains exception-first while retaining all structured facts upstream;
- Exit/Comparison rendering exposes reviewed comparison findings without inferring liability;
- Maintenance presentation references approved findings without creating new maintenance truth;
- browser preview and final PDF consume the same shared view/document models;
- generated scope text does not introduce tenant-liability, bond-deduction or causation conclusions;
- final render and archive manifests retain presentation-template, branding, renderer and font-bundle identity.

## Visual regression follow-up

The repository now has deterministic document-model and PDF stress tests. Pixel/raster visual regression should be enabled in CI once a stable PDF rasteriser is pinned in the build image. Golden fixtures should cover Entry, Routine, Exit, Comparison and Maintenance reports, long commentary, empty sections, large evidence sets and amendment/supersession states.

## Typography and Unicode

Presentation identity includes a font-bundle version so a future embedded Unicode font bundle cannot silently alter existing artifacts. Until a licensed embedded font bundle is pinned and included in the worker image, final rendering must keep a deterministic safe-text fallback and must not claim native full-Unicode typography support.
