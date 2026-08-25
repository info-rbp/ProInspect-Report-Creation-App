#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/google-cloud-release.sh PROJECT_ID RELEASE_ID [REGION]

Builds and deploys the API, PDF, notification, dashboard, document and integration
workers through Cloud Build without using GitHub Actions. Terraform must already have
provisioned the target environment. RELEASE_ID should be an immutable source
revision, normally the full Git commit SHA.
EOF
}

PROJECT_ID=${1:-}
RELEASE_ID=${2:-}
REGION=${3:-australia-southeast1}

if [[ -z "$PROJECT_ID" || -z "$RELEASE_ID" ]]; then
  usage >&2
  exit 64
fi
if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Invalid Google Cloud project id: $PROJECT_ID" >&2
  exit 64
fi
if [[ ! "$RELEASE_ID" =~ ^[A-Za-z0-9._-]{7,64}$ ]]; then
  echo "RELEASE_ID must be a stable revision identifier (7-64 safe characters)." >&2
  exit 64
fi

command -v gcloud >/dev/null 2>&1 || { echo 'gcloud is required.' >&2; exit 69; }

BUILD_SERVICE_ACCOUNT="projects/$PROJECT_ID/serviceAccounts/cloud-build@$PROJECT_ID.iam.gserviceaccount.com"

echo "Validating project, build identity and required Cloud Run services..."
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud iam service-accounts describe "cloud-build@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" --format='value(email)' >/dev/null
for service in api pdf-worker notification-worker dashboard-worker; do
  gcloud run services describe "$service" --project="$PROJECT_ID" --region="$REGION" --format='value(metadata.name)' >/dev/null
done

echo "Submitting release $RELEASE_ID to $PROJECT_ID ($REGION)..."
gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-account="$BUILD_SERVICE_ACCOUNT" \
  --config=infrastructure/cloud-build/release.yaml \
  --substitutions="_REGION=$REGION,_RELEASE_ID=$RELEASE_ID" \
  .

echo "Release deployment completed. Capture the Cloud Build id and deployed Cloud Run revision names in the release evidence pack."
