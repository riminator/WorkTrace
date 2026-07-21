#!/usr/bin/env bash
# openshift/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
# Full redeploy of KnowledgeBase to OpenShift.
# Run from the REPO ROOT:
#
#   ./openshift/deploy.sh
#
# Prerequisites:
#   1. openshift/deploy.env exists and is filled in (copy from deploy.env.example)
#   2. docker + docker buildx are available and Docker Desktop is running
#   3. oc CLI is installed
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Resolve repo root regardless of where the script is called from ───────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_ENV="$SCRIPT_DIR/deploy.env"

# ── Load secrets from deploy.env ──────────────────────────────────────────────
if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo ""
  echo "  ERROR: $DEPLOY_ENV not found."
  echo "  Copy the example and fill it in:"
  echo "    cp openshift/deploy.env.example openshift/deploy.env"
  echo "    nano openshift/deploy.env"
  echo ""
  exit 1
fi

# shellcheck disable=SC1090
set -o allexport
source "$DEPLOY_ENV"
set +o allexport

# ── Validate required vars ────────────────────────────────────────────────────
REQUIRED=(
  REGISTRY OC_SERVER OC_TOKEN OC_PROJECT
  VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
  SUPABASE_URL SUPABASE_JWT_SECRET
  EMBED_PROVIDER NOMIC_API_KEY NOMIC_EMBED_MODEL EMBED_DIMENSIONS
  LLM_PROVIDER RAG_TOP_K POSTGRES_PASSWORD
  SUPABASE_PG_URL
)
MISSING=()
for VAR in "${REQUIRED[@]}"; do
  [[ -z "${!VAR:-}" ]] && MISSING+=("$VAR")
done
# Provider-specific validation
case "${LLM_PROVIDER:-}" in
  watsonx)
    for VAR in WATSONX_API_KEY WATSONX_URL WATSONX_PROJECT_ID WATSONX_MODEL_ID; do
      [[ -z "${!VAR:-}" ]] && MISSING+=("$VAR")
    done ;;
  openai)
    for VAR in OPENAI_API_KEY OPENAI_BASE_URL OPENAI_CHAT_MODEL; do
      [[ -z "${!VAR:-}" ]] && MISSING+=("$VAR")
    done ;;
esac
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  echo "  ERROR: The following variables are not set in deploy.env:"
  for V in "${MISSING[@]}"; do echo "    - $V"; done
  echo ""
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  WorkTrace → OpenShift Deploy"
echo "══════════════════════════════════════════════════════"
echo ""

# ── Step 1: Build and push images ─────────────────────────────────────────────
echo "▶ [1/5] Building and pushing images to $REGISTRY"
echo ""

cd "$REPO_ROOT"

echo "  → backend"
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f openshift/Dockerfile.backend \
  -t "$REGISTRY/knowledgebase-backend:latest" \
  --push \
  ./backend

echo ""
echo "  → frontend"
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f openshift/Dockerfile.frontend \
  --build-arg VITE_API_URL=/api \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
  -t "$REGISTRY/knowledgebase-frontend:latest" \
  --push \
  .

echo ""
echo "  ✓ Images pushed"
echo ""

# ── Step 2: Log into OpenShift ────────────────────────────────────────────────
echo "▶ [2/5] Logging into OpenShift"
oc login --token="$OC_TOKEN" --server="$OC_SERVER"

# Create or switch to the project
if oc get project "$OC_PROJECT" &>/dev/null; then
  oc project "$OC_PROJECT"
else
  oc new-project "$OC_PROJECT"
fi
echo "  ✓ Logged in → project: $OC_PROJECT"
echo ""

# ── Step 3: Deploy in-cluster Postgres (pgvector) ────────────────────────────
echo "▶ [3/5] Deploying in-cluster Postgres"

# Create/update the postgres credentials secret from deploy.env
oc create secret generic postgres-credentials \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=POSTGRES_DB=vector \
  --dry-run=client -o yaml | oc apply -f -

oc apply -f "$SCRIPT_DIR/postgres.yaml"

# Wait for Postgres to be ready before the backend tries to connect
echo "  Waiting for Postgres to be ready..."
oc rollout status statefulset/knowledgebase-postgres --timeout=120s
echo "  ✓ Postgres ready"
echo ""

# ── Auto-restore from latest backup if one exists ─────────────────────────────
LATEST_BACKUP=$(ls -t "$REPO_ROOT"/kb_backup_*.sql 2>/dev/null | head -1 || true)
if [[ -n "$LATEST_BACKUP" ]]; then
  echo "  Found backup: $(basename "$LATEST_BACKUP")"
  echo "  Restoring data..."
  PG_POD=$(oc get pod -l app=knowledgebase-postgres -o jsonpath='{.items[0].metadata.name}')
  oc exec -i "$PG_POD" -- psql -U postgres vector < "$LATEST_BACKUP"
  echo "  ✓ Data restored from $(basename "$LATEST_BACKUP")"
  echo ""
fi

# Build the in-cluster DATABASE_URL from the postgres-credentials secret
PG_PASS=$(oc get secret postgres-credentials -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
DATABASE_URL="postgresql://postgres:${PG_PASS}@knowledgebase-postgres:5432/vector"
TTT_DATABASE_URL="postgresql://postgres:${PG_PASS}@knowledgebase-postgres:5432/vector?sslmode=disable"
TTT_PGSSL="false"

# ── Step 4: Apply secret ──────────────────────────────────────────────────────
echo "▶ [4/5] Applying secrets"

# Build provider-specific LLM args
LLM_ARGS=()
case "$LLM_PROVIDER" in
  watsonx)
    LLM_ARGS=(
      --from-literal=WATSONX_API_KEY="$WATSONX_API_KEY"
      --from-literal=WATSONX_URL="$WATSONX_URL"
      --from-literal=WATSONX_PROJECT_ID="$WATSONX_PROJECT_ID"
      --from-literal=WATSONX_MODEL_ID="$WATSONX_MODEL_ID"
    ) ;;
  openai)
    LLM_ARGS=(
      --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY"
      --from-literal=OPENAI_BASE_URL="$OPENAI_BASE_URL"
      --from-literal=OPENAI_CHAT_MODEL="$OPENAI_CHAT_MODEL"
    ) ;;
esac

oc create secret generic knowledgebase-secrets \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=TTT_DATABASE_URL="$TTT_DATABASE_URL" \
  --from-literal=TTT_PGSSL="$TTT_PGSSL" \
  --from-literal=SUPABASE_URL="$SUPABASE_URL" \
  --from-literal=SUPABASE_JWT_SECRET="$SUPABASE_JWT_SECRET" \
  --from-literal=SUPABASE_PG_URL="$SUPABASE_PG_URL" \
  --from-literal=EMBED_PROVIDER="$EMBED_PROVIDER" \
  --from-literal=NOMIC_API_KEY="$NOMIC_API_KEY" \
  --from-literal=NOMIC_EMBED_MODEL="$NOMIC_EMBED_MODEL" \
  --from-literal=EMBED_DIMENSIONS="$EMBED_DIMENSIONS" \
  --from-literal=LLM_PROVIDER="$LLM_PROVIDER" \
  --from-literal=RAG_TOP_K="$RAG_TOP_K" \
  --from-literal=USE_LANGCHAIN="${USE_LANGCHAIN:-false}" \
  --from-literal=ADMIN_USER_IDS="${ADMIN_USER_IDS:-}" \
  "${LLM_ARGS[@]}" \
  --dry-run=client -o yaml | oc apply -f -
echo "  ✓ Secret applied"
echo ""

# ── Step 5: Deploy app ────────────────────────────────────────────────────────
echo "▶ [5/5] Deploying to OpenShift"
oc apply -f "$SCRIPT_DIR/backend.yaml"
oc apply -f "$SCRIPT_DIR/frontend.yaml"
oc apply -f "$SCRIPT_DIR/sync-cronjob.yaml"

# Force pods to pull the freshly pushed images
oc rollout restart deployment/knowledgebase-backend
oc rollout restart deployment/knowledgebase-frontend

echo ""
echo "  Waiting for rollouts to complete..."
oc rollout status deployment/knowledgebase-backend --timeout=120s
oc rollout status deployment/knowledgebase-frontend --timeout=120s

# ── Done — print the URL ──────────────────────────────────────────────────────
ROUTE_HOST=$(oc get route knowledgebase -o jsonpath='{.spec.host}' 2>/dev/null || echo "")

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✓ Deploy complete!"
echo ""
if [[ -n "$ROUTE_HOST" ]]; then
  echo "  App URL:  https://$ROUTE_HOST"
else
  echo "  Run: oc get route knowledgebase"
fi
echo ""
echo "  ⚠  Remember to update Supabase redirect URLs:"
echo "     Authentication → URL Configuration"
echo "     Site URL:      https://$ROUTE_HOST"
echo "     Redirect URLs: https://$ROUTE_HOST/**"
echo "══════════════════════════════════════════════════════"
echo ""
