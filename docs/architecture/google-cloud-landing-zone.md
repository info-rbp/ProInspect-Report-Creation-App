# Google Cloud landing zone

## Environment isolation

Development, staging and production use separate Google Cloud projects. They do not share Firestore databases, buckets, service accounts, secrets, budgets or deployment targets.

Project IDs are supplied as Terraform variables because Google Cloud project IDs are globally unique and organisation-specific. The expected naming pattern is:

- `pcr-development-<organisation suffix>`
- `pcr-staging-<organisation suffix>`
- `pcr-production-<organisation suffix>`

## Primary location

The approved primary region is Sydney: `australia-southeast1`.

The following resources are explicitly placed in Sydney where the service supports a regional location:

- Firestore
- Cloud Storage
- Cloud Run
- Cloud Tasks
- Artifact Registry
- Cloud Build and Cloud Deploy regional resources
- Secret Manager regional replicas
- Cloud Logging regional bucket
- Vertex AI processing through the `VERTEX_AI_LOCATION` runtime setting

## Services without a fully regional control plane

Some Google Cloud products refuse to fit neatly into a single-region diagram, because distributed systems enjoy paperwork.

| Service | Location treatment |
| --- | --- |
| Firebase Hosting | Global edge delivery. Origin data and application backends remain in the environment project. |
| Identity Platform | Project-scoped service with no deployable regional instance. Authorised domains and sign-in policy are managed by Terraform. |
| Pub/Sub | Globally addressed. Topic message-storage policies restrict persistence to `australia-southeast1` and enforce the policy in transit. |
| Cloud Monitoring | Global control plane. Alerting policies monitor Sydney resources and use project-scoped notification channels. |
| Cloud Billing Budgets | Billing-account control plane. Budgets are filtered to one project and publish to the environment budget topic. |
| Vertex AI | The API is enabled per project. Runtime processing defaults to Sydney. Model availability must be verified per model before release; a non-Sydney endpoint requires a recorded architecture decision and privacy review. |

## Security model

- No shared production service accounts.
- No service-account keys in GitHub or Terraform.
- GitHub Actions uses Workload Identity Federation.
- Runtime identities receive only their required project and bucket roles.
- Cloud Run workers require authenticated invocation.
- Public API invocation is an explicit environment variable and does not replace application-level Identity Platform token verification.
- Buckets enforce uniform access and public-access prevention.
- Production Firestore, Cloud Run, Firebase Hosting and Cloud Deploy resources use deletion protection where the provider supports it.
- Secret payloads are not managed in Terraform state.

## Delivery and approval

Cloud Deploy contains development, staging and production targets. The production target has `require_approval = true`. The GitHub Terraform apply workflow also targets a GitHub environment named `production`; repository administrators must configure required reviewers for that environment.

Both controls are intentional. A production deployment should require approval even when one vendor decides to have an exciting afternoon.

## Required external configuration

The repository cannot invent the following organisation-specific values:

- Google Cloud organisation or folder ID
- Billing account ID
- Globally unique project IDs
- Workload Identity Federation provider and Terraform service-account principal
- Alert recipient addresses

Those values are supplied through Terraform variable files or protected GitHub repository/environment variables. They are not hard-coded.
