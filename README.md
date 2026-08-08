# Remote Business Partner Property Condition Reporter

A property inspection platform for Entry Property Condition Reports, Routine Inspections, Exit Inspections, Comparison Reports, and Maintenance and Follow-Up reports.

## Current status

Phase 1 product definition is complete. Phase 2 establishes a stable engineering baseline and monorepo structure. The current report-building interface remains operational while the production Google Cloud workflow is implemented through issues #3 through #10.

## Authoritative product documentation

- [Inspection type requirements](docs/product/inspection-types.md)
- [End-to-end inspection business workflow](docs/product/business-workflow.md)
- [Release scope and product priorities](docs/product/release-scope.md)
- [Role and capability matrix](docs/product/role-capability-matrix.md)
- [Phase 1 completion record](docs/product/phase-1-completion.md)

## Repository structure

```text
/apps
  /web
  /api
  /ai-worker
  /pdf-worker
/packages
  /domain
  /validation
  /ui
  /templates
  /testing
  /config
/infrastructure
  /terraform
  /firebase
  /cloud-deploy
```

The web application contains the existing React and Vite report builder. The API and workers provide typed foundations for later Cloud Run deployment. Shared packages prevent each application from inventing its own interpretation of reports, errors, validation, configuration, and templates.

## Local development

Prerequisites:

- Node.js 22
- npm 10 or later
- Java 21 for Firebase emulators

Install dependencies and start the complete local environment:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run dev:local
```

This starts:

- Firebase Auth, Firestore, Storage, Hosting, and Emulator UI
- API on port 8080
- Web application on port 3000

Detailed instructions are in [Local Development](docs/development/local-development.md).

## Validation

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run test:emulator
npm run test:e2e
```

The standard pull-request gate is:

```bash
npm run check
```

## Engineering standards

The repository now includes:

- npm workspaces
- strict TypeScript configuration
- shared domain and validation packages
- consistent API error contracts and correlation IDs
- structured JSON logging foundations
- automated formatting checks
- Dependabot configuration
- CODEOWNERS and a pull-request template
- unit, API, rules, emulator, and Playwright test foundations
- CI validation for the workspace and browser smoke tests

## Firebase and Google Cloud

Firebase configuration now lives under `infrastructure/firebase`.

The approved target architecture uses:

- Firebase Hosting
- Identity Platform
- Cloud Run
- Firestore
- Cloud Storage
- Cloud Tasks
- Pub/Sub
- Vertex AI
- Secret Manager
- Cloud Logging and Cloud Monitoring
- Artifact Registry, Cloud Build, and Cloud Deploy

Terraform and Cloud Deploy directories are established as controlled infrastructure boundaries. Their environment implementation is tracked in issue #3.

## Current runtime limitations

The existing web interface still uses browser-configured Gemini access, optional Firebase synchronisation, browser-generated PDFs, and prototype workflow controls. These are deliberately identified as transitional and are replaced by the subsequent implementation workstreams. A directory existing does not magically make a production service appear, despite generations of optimistic architecture diagrams suggesting otherwise.
