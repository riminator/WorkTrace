#!/usr/bin/env bash
# iks/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
# Full deploy of WorkTrace to IBM Cloud Kubernetes Service (IKS).
# Run from the REPO ROOT:
#
#   ./iks/deploy.sh
#
# Prerequisites:
#   1. iks/deploy.env exists and is filled in (copy from iks/deploy.env.example)
#   2. ibmcloud CLI installed + logged in:
#        ibmcloud login --sso          (or ibmcloud login -u email -p pass)
#   3. ibmcloud ks plugin installed:
#        ibmcloud plugin install container-service
#   4. kubectl installed
#   5. docker + docker buildx available
#
# What this script does:
#   1. Builds and pushes both Docker images to Quay
#   2. Logs into IBM Cloud and configures kubectl for the IKS cluster
#   3. Deploys in-cluster Postgres (pgvector) with a 20 Gi PVC
#   4. Auto-restores from the latest kb_backup_*.sql if one exists
#   5. Applies all secrets and manifests
#   6. Waits for rollouts and prints the stable Ingress URL
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_ENV="$SCRIPT_DIR/deploy.env"

# ── Load secrets ──────────────────────────────────────────────────────────────
if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo ""
  echo "  ERROR: $DEPLOY_ENV not found."
  echo "  Copy the example and fill it in:"
  echo "    cp iks/deploy.env.example iks/deploy.env"
  echo "    nano iks/deploy.env"
  echo ""
  exit 1
fi

# shellcheck disable=SC1090
set -o allexport
source "$DEPLOY_ENV"
set +o allexport

# ── Validate required vars ────────────────────────────────────────────────────
REQUIRED=(
  REGISTRY IKS_CLUSTER_NAME
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
  echo "  ERROR: The following variables are not set in iks/deploy.env:"
  for V in "${MISSING[@]}"; do echo "    - $V"; done
  echo ""
  exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  WorkTrace → IKS Deploy"
echo "══════════════════════════════════════════════════════"
echo ""

# ── Step 1: Build and push images ─────────────────────────────────────────────
echo "▶ [1/6] Building and pushing images to $REGISTRY"
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

# ── Step 2: Configure kubectl for IKS ────────────────────────────────────────
echo "▶ [2/6] Configuring kubectl for IKS cluster: $IKS_CLUSTER_NAME"
ibmcloud ks cluster config --cluster "$IKS_CLUSTER_NAME"
echo "  ✓ kubectl configured"
echo ""

# Resolve the namespace — IKS free tier uses 'default'
NAMESPACE="${IKS_NAMESPACE:-default}"
kubectl config set-context --current --namespace="$NAMESPACE"

# ── Step 3: Retrieve stable Ingress subdomain ─────────────────────────────────
echo "▶ [3/6] Retrieving cluster Ingress subdomain"
INGRESS_SUBDOMAIN=$(ibmcloud ks cluster get --cluster "$IKS_CLUSTER_NAME" --output json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ingressHostname',''))")
INGRESS_SECRET=$(ibmcloud ks cluster get --cluster "$IKS_CLUSTER_NAME" --output json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ingressSecretName',''))")

if [[ -z "$INGRESS_SUBDOMAIN" ]]; then
  echo ""
  echo "  WARNING: Ingress subdomain not yet provisioned — cluster may still be initialising."
  echo "  Re-run this script in a few minutes, or check:"
  echo "    ibmcloud ks cluster get --cluster $IKS_CLUSTER_NAME"
  echo ""
  echo "  Continuing without Ingress (you can apply iks/frontend.yaml manually later)."
  INGRESS_SUBDOMAIN="PLACEHOLDER.containers.appdomain.cloud"
  INGRESS_SECRET="PLACEHOLDER-tls"
fi

export INGRESS_SUBDOMAIN INGRESS_SECRET
echo "  ✓ Ingress subdomain: $INGRESS_SUBDOMAIN"
echo ""

# ── Step 4: Deploy in-cluster Postgres ───────────────────────────────────────
echo "▶ [4/6] Deploying in-cluster Postgres (pgvector)"

kubectl create secret generic postgres-credentials \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=POSTGRES_DB=vector \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f "$SCRIPT_DIR/postgres.yaml"

echo "  Waiting for Postgres to be ready..."
kubectl rollout status statefulset/knowledgebase-postgres --timeout=120s
echo "  ✓ Postgres ready"
echo ""

# ── Auto-restore from latest backup ──────────────────────────────────────────
LATEST_BACKUP=$(ls -t "$REPO_ROOT"/kb_backup_*.sql 2>/dev/null | head -1 || true)
if [[ -n "$LATEST_BACKUP" ]]; then
  echo "  Found backup: $(basename "$LATEST_BACKUP")"
  echo "  Restoring data..."
  PG_POD=$(kubectl get pod -l app=knowledgebase-postgres -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -i "$PG_POD" -- psql -U postgres vector < "$LATEST_BACKUP"
  echo "  ✓ Data restored from $(basename "$LATEST_BACKUP")"
  echo ""
fi

# ── Step 5: Apply secrets and manifests ──────────────────────────────────────
echo "▶ [5/6] Applying secrets and manifests"

# Build DATABASE_URL from the secret we just created
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@knowledgebase-postgres:5432/vector"
TTT_DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@knowledgebase-postgres:5432/vector?sslmode=disable"
TTT_PGSSL="false"

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

kubectl create secret generic knowledgebase-secrets \
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
  --from-literal=USE_LLM_CLASSIFY="${USE_LLM_CLASSIFY:-false}" \
  --from-literal=ADMIN_USER_IDS="${ADMIN_USER_IDS:-}" \
  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  --from-literal=OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.groq.com/openai/v1}" \
  "${LLM_ARGS[@]}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f "$SCRIPT_DIR/backend.yaml"
# Substitute Ingress placeholders before applying frontend.yaml
envsubst < "$SCRIPT_DIR/frontend.yaml" | kubectl apply -f -
kubectl apply -f "$SCRIPT_DIR/backup-cronjob.yaml"
kubectl apply -f "$SCRIPT_DIR/sync-cronjob.yaml"

echo "  ✓ Manifests applied"
echo ""

# ── Step 6: Roll deployments and wait ────────────────────────────────────────
echo "▶ [6/6] Rolling deployments"
kubectl rollout restart deployment/knowledgebase-backend deployment/knowledgebase-frontend

echo "  Waiting for rollouts to complete..."
kubectl rollout status deployment/knowledgebase-backend --timeout=120s
kubectl rollout status deployment/knowledgebase-frontend --timeout=120s

# ── Done ──────────────────────────────────────────────────────────────────────
APP_URL="https://$INGRESS_SUBDOMAIN"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✓ Deploy complete!"
echo ""
echo "  App URL (permanent, never changes):"
echo "  $APP_URL"
echo ""
echo "  ─────────────────────────────────────────────────"
echo "  ⚠  One-time post-deploy steps (do these once):"
echo ""
echo "  1. Supabase redirect URLs:"
echo "     Authentication → URL Configuration"
echo "     Site URL:      $APP_URL"
echo "     Redirect URLs: $APP_URL/**"
echo ""
echo "  2. Outlook sync plist — update --worktrace-url:"
echo "     $APP_URL"
echo "     Then reload: launchctl unload ~/Library/LaunchAgents/com.worktrace.outlooksync.plist"
echo "                  launchctl load   ~/Library/LaunchAgents/com.worktrace.outlooksync.plist"
echo ""
echo "  3. Bob MCP server — update WORKTRACE_URL in ~/.bob/settings/mcp.json:"
echo "     \"WORKTRACE_URL\": \"$APP_URL\""
echo "  ─────────────────────────────────────────────────"
echo "══════════════════════════════════════════════════════"
echo ""
