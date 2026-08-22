# GitHub Actions quota release waiver

## Scope

This is a temporary, explicit release-control exception for PR #48 (`implementation/production-readiness-closeout`) on 22 August 2026.

GitHub-hosted Actions for the repository has exhausted its monthly allocation. Runs on the merge candidate are therefore created but fail before any workflow step receives a runner. This is an infrastructure/quota condition, not a passing validation result and not a test failure.

## Authority

The repository owner explicitly authorised completing the production-readiness closeout while bypassing GitHub Actions for this quota period. This waiver does **not** waive application safety, cloud acceptance, or rollback requirements.

## Replacement controls

The following controls replace the unavailable hosted Actions gate for this exceptional merge:

1. The last integrated `main` baseline (`049bd7d4cb9e978b42963ffde3807a44810c238b`) was merged after combined CI run 692 passed.
2. PR #48 changes are retained in one mergeable branch and reviewed through repository diffs/static contract checks before merge.
3. Known defects discovered during the static review are corrected before merge rather than deferred.
4. `infrastructure/cloud-build/validate.yaml` reproduces the repository validation suite outside GitHub Actions: workspace typechecks, formatting, lint, unit/rules tests, application builds, artifact verification, Firebase emulator tests, Playwright browser tests, and Terraform formatting/provider validation.
5. `bash scripts/google-cloud-validate.sh PROJECT_ID` invokes that validation using the Terraform-managed Cloud Build service account once an authenticated Google Cloud operator/control plane is available.
6. `infrastructure/cloud-build/release.yaml` and `bash scripts/google-cloud-release.sh PROJECT_ID RELEASE_ID` provide an image-only release path that preserves Terraform-owned Cloud Run IAM, secrets, networking and schedulers.
7. Production rollout remains blocked until development and staging acceptance evidence is captured.

## Merge rules under this exception

The PR may be merged without a green GitHub Actions check only because the monthly Actions quota is exhausted and the owner has explicitly authorised this exception. Before merge:

- the exact head SHA must be recorded in the PR body or merge message;
- the PR must be mergeable with no base conflict;
- no known unresolved code/security defect may remain in the changed paths;
- the rollback point is the pre-merge `main` SHA above;
- cloud deployment must use the same immutable merge revision across environments.

The PR body/merge message is the authoritative place for the final head SHA because this waiver document itself changes the branch SHA when edited.

## Mandatory post-quota reconciliation

When GitHub Actions capacity becomes available again, run the normal full validation against the then-current `main`. A failure is a release defect even if the quota-waived merge has already occurred and must be corrected immediately.

After the quota resets, branch protection can be applied with:

```bash
CONFIRM_ACTIONS_CAPACITY=available bash scripts/configure-main-branch-protection.sh info-rbp/ProInspect-Report-Creation-App main
```

That policy requires pull requests, conversation resolution and `ci/full-validation`. It is intentionally guarded so the unavailable status check cannot lock the repository during the quota-exhausted period. Human systems do have a talent for turning temporary bypasses into architecture.

## Deliberate non-waived gates

This exception does not claim completion of controls that require real external systems or approved binary assets:

- Terraform apply and Cloud Run revision promotion in development/staging/production;
- environment-specific Firebase App Check/reCAPTCHA Enterprise key activation and enforcement;
- live SendGrid/Twilio/Xero provider acceptance;
- real staging Identity Platform/session-revocation scenarios;
- an approved embedded full-Unicode PDF font bundle and its immutable version;
- pinned rasteriser plus reviewed pixel-golden report fixtures.

Those remain release/acceptance gates until evidence exists.
