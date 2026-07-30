#!/usr/bin/env bash
# iks/dump.sh
# ─────────────────────────────────────────────────────────────────────────────
# Dump the in-cluster pgvector database to a local SQL file.
# IKS equivalent of openshift/dump.sh — uses kubectl instead of oc.
#
# Usage (from repo root):
#   ./iks/dump.sh
#
# Output: kb_backup_<date>.sql in the repo root (gitignored)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_ENV="$SCRIPT_DIR/deploy.env"

# ── Load deploy.env for IKS_CLUSTER_NAME ─────────────────────────────────────
if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "ERROR: iks/deploy.env not found. Run from repo root after filling in deploy.env."
  exit 1
fi
set -o allexport; source "$DEPLOY_ENV"; set +o allexport

# ── Configure kubectl ─────────────────────────────────────────────────────────
echo "▶ Configuring kubectl for cluster: $IKS_CLUSTER_NAME"
ibmcloud ks cluster config --cluster "$IKS_CLUSTER_NAME" 2>/dev/null
kubectl config set-context --current --namespace="${IKS_NAMESPACE:-default}"

# ── Find the postgres pod ─────────────────────────────────────────────────────
POD=$(kubectl get pod -l app=knowledgebase-postgres \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)

if [[ -z "$POD" ]]; then
  echo "ERROR: No knowledgebase-postgres pod found."
  echo "       Is the cluster running? Try: kubectl get pods"
  exit 1
fi

# ── Dump ──────────────────────────────────────────────────────────────────────
OUTFILE="$REPO_ROOT/kb_backup_$(date +%Y%m%d_%H%M%S).sql"

echo ""
echo "▶ Dumping database from pod $POD..."
kubectl exec "$POD" -- pg_dump -U postgres vector > "$OUTFILE"

echo "  ✓ Saved to: $OUTFILE"

# ── Prune old backups — keep newest 2 ────────────────────────────────────────
mapfile -t OLD_BACKUPS < <(ls -t "$REPO_ROOT"/kb_backup_*.sql 2>/dev/null)
if [[ ${#OLD_BACKUPS[@]} -gt 2 ]]; then
  echo ""
  echo "▶ Pruning old backups (keeping newest 2)..."
  for (( i=2; i<${#OLD_BACKUPS[@]}; i++ )); do
    rm -f "${OLD_BACKUPS[$i]}"
    echo "  ✗ Deleted: ${OLD_BACKUPS[$i]}"
  done
fi

echo ""
echo "Backups retained:"
ls -lh "$REPO_ROOT"/kb_backup_*.sql 2>/dev/null | awk '{print "  " $5, $9}'
echo ""
echo "To restore on a new cluster after running iks/deploy.sh:"
echo "  POD=\$(kubectl get pod -l app=knowledgebase-postgres -o jsonpath='{.items[0].metadata.name}')"
echo "  kubectl exec -i \$POD -- psql -U postgres vector < $OUTFILE"
echo ""
