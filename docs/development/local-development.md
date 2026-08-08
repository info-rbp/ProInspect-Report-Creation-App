# Local development
## Prerequisites
- Node.js 22
- npm 10+
- Java 21 for Firebase emulators
## Setup
```bash
npm install --ignore-scripts --no-audit --no-fund
npm run dev:local
```
The command starts Firebase emulators, the API on port 8080 and the web app on port 3000.
## Validation
```bash
npm run check
npm run test:e2e
```
## Workspace layout
- `apps/web`: React/Vite application
- `apps/api`: authoritative HTTP API foundation
- `apps/ai-worker`: asynchronous analysis worker foundation
- `apps/pdf-worker`: PDF worker foundation
- `packages/*`: shared domain, validation, UI, templates, testing and configuration
- `infrastructure/*`: Firebase, Terraform and Cloud Deploy configuration
