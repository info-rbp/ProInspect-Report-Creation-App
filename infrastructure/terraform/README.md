# Google Cloud landing zone

This directory defines the development, staging and production Google Cloud landing zone for the Property Condition Report platform.

## Design

- Each environment is a separate Google Cloud project.
- Sydney (`australia-southeast1`) is the primary region.
- Terraform state is stored in a separate versioned bucket in each project.
- Runtime identities are separate for the API, AI worker, PDF worker, Cloud Build and Cloud Deploy.
- Secret Manager resources contain metadata only. Secret values are supplied outside Terraform.
- The Cloud Deploy production target requires approval.
- GitHub Actions authenticates with Workload Identity Federation. Long-lived service-account keys are not supported.

See [`docs/architecture/google-cloud-landing-zone.md`](../../docs/architecture/google-cloud-landing-zone.md) for location and service-boundary decisions.

## Layout

- `bootstrap/`: creates the three projects and their Terraform state buckets.
- `modules/project/`: project creation and bootstrap APIs.
- `modules/environment/`: reusable per-environment services and controls.
- `environments/{development,staging,production}/`: environment roots and example inputs.
- `delivery/`: central Cloud Deploy pipeline with mandatory production approval.

## Prerequisites

1. A Google Cloud organisation or folder.
2. A billing account.
3. Globally unique project IDs for all three environments.
4. An authenticated principal allowed to create projects, attach billing, enable APIs and administer IAM.
5. Terraform 1.15.x.

## Bootstrap sequence

Terraform cannot use a state bucket before that bucket exists, because time remains stubbornly linear.

1. Copy `bootstrap/terraform.tfvars.example` to `bootstrap/terraform.tfvars` and set the organisation or folder, billing account and project IDs.
2. Run the bootstrap root with local state:

   ```bash
   cd infrastructure/terraform/bootstrap
   terraform init
   terraform plan -out bootstrap.tfplan
   terraform apply bootstrap.tfplan
   ```

3. Copy each environment example file to `terraform.tfvars` and replace its backend bucket placeholder with the corresponding bootstrap output.
4. Initialise and apply development, then staging.
5. Apply production through the protected GitHub `production` environment and then apply `delivery/`.

## Secret values

Terraform creates regional Secret Manager containers but never stores secret payloads in state. Add versions using an approved secret-delivery process. Never add secret values to `.tfvars`, GitHub logs or Terraform state.

## GitHub environments

Configure separate GitHub Environments named `development`, `staging` and `production`. The `production` environment must require an authorised reviewer. The `delivery` stack intentionally uses the protected production environment.

Required variables and secrets:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_TERRAFORM_SERVICE_ACCOUNT`
- `TF_STATE_BUCKET`
- protected secret `TERRAFORM_TFVARS_JSON`

## Validation

```bash
terraform fmt -check -recursive infrastructure/terraform
terraform -chdir=infrastructure/terraform/bootstrap init -backend=false
terraform -chdir=infrastructure/terraform/bootstrap validate
```

The `Terraform` GitHub workflow performs formatting and provider-aware validation for every root module.
