#!/usr/bin/env bash
set -euo pipefail

REPOSITORY=${1:-info-rbp/ProInspect-Report-Creation-App}
BRANCH=${2:-main}

if [[ ! "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Usage: scripts/configure-main-branch-protection.sh OWNER/REPOSITORY [BRANCH]" >&2
  exit 64
fi
command -v gh >/dev/null 2>&1 || { echo 'GitHub CLI (gh) is required.' >&2; exit 69; }

gh auth status >/dev/null

if [[ "${CONFIRM_ACTIONS_CAPACITY:-}" != "available" ]]; then
  cat >&2 <<'EOF'
Refusing to require ci/full-validation while GitHub Actions capacity is unavailable.
After the monthly quota resets, run:
  CONFIRM_ACTIONS_CAPACITY=available scripts/configure-main-branch-protection.sh OWNER/REPOSITORY main
EOF
  exit 78
fi

payload=$(cat <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci/full-validation"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_linear_history": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
)

echo "$payload" | gh api \
  --method PUT \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "repos/$REPOSITORY/branches/$BRANCH/protection" \
  --input - >/dev/null

echo "Protected $REPOSITORY:$BRANCH with PR review, conversation resolution and ci/full-validation requirements."
