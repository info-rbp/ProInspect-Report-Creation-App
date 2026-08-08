# Cloud Deploy

Terraform in `infrastructure/terraform/delivery` creates one regional delivery pipeline with development, staging and production Cloud Run targets.

Production promotion requires approval at the Cloud Deploy target. Production Terraform applies also run through the protected GitHub `production` environment.

Application delivery will supply release-specific Skaffold manifests. This phase establishes the pipeline, target identities and approval boundary without pretending the current worker foundations are finished containers.
