# Runtime, security and API contract policy

## Source of truth
GitHub `main` is the canonical application source. Feature and repair work must be performed on branches and merged by pull request. Google AI Studio is a preview and acceptance-testing environment; it must not be treated as an independent source of truth.

## Provider administration
ProInspect provider administrators are explicit records under `serviceProviders/{providerId}/memberships/{uid}`. Missing agency membership never creates an administrator implicitly. Use `npm run provision:provider-admin -- <email>` with Application Default Credentials to create the provider membership, home-agency membership and Firebase claims.

## API runtime
Production and staging require `VITE_API_BASE_URL`. Local development may set `VITE_USE_DEV_API_PROXY=true`, in which case requests use the Vite `/api` reverse proxy to the API process on port 8080.

## Demo data
API errors are errors. They must not silently substitute synthetic operational data. Demo/mock behaviour is permitted only when `VITE_DEMO_MODE=true` and must be visibly identifiable as demo data.

## Route verification
`apps/api/tests/platformEnhancementContract.test.ts` verifies that critical platform routes, including `/api/v1/inspection-route-plans`, are mounted. `npm run smoke:api` performs a read-only smoke pass against a deployed API when `API_BASE_URL`, `API_BEARER_TOKEN` and `API_AGENCY_ID` are supplied.

## Branch protection
After GitHub Actions capacity is available, run `CONFIRM_ACTIONS_CAPACITY=available scripts/configure-main-branch-protection.sh info-rbp/ProInspect-Report-Creation-App main` to require pull requests, one approval, conversation resolution and `ci/full-validation` before merge.
