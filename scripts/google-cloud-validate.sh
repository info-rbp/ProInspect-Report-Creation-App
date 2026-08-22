#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=${1:-}
REGION=${2:-australia-southeast1}

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: scripts/google-cloud-validate.sh PROJECT_ID [REGION]" >&2
  exit 64
fi
if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Invalid Google Cloud project id: $PROJECT_ID" >&2
  exit 64
fi

command -v gcloud >/dev/null 2>&1 || { echo 'gcloud is required.' >&2; exit 69; }
BUILD_SERVICE_ACCOUNT="projects/$PROJECT_ID/serviceAccounts/cloud-build@$PROJECT_ID.iam.gserviceaccount.com"

gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud iam service-accounts describe "cloud-build@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" --format='value(email)' >/dev/null

gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-account="$BUILD_SERVICE_ACCOUNT" \
  --config=infrastructure/cloud-build/validate.yaml \
  .
