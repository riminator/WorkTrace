#!/usr/bin/env bash
# openshift/dump.sh
# ─────────────────────────────────────────────────────────────────────────────
# Dump the in-cluster pgvector database to a local SQL file.
# Run this BEFORE your cluster reservation expires.
#
# Usage (from repo root):
#   ./openshift/dump.sh
#
# Output: kb_backup_<date>.sql in the repo root (gitignored)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_ENV="$SCRIPT_DIR/deploy.env"

# ── Load deploy.env for OC_SERVER / OC_TOKEN / OC_PROJECT ────────────────────
if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "ERROR: openshift/deploy.env not found. Run from repo root after filling in deploy.env."
  exit 1
fi
set -o allexport; source "$DEPLOY_ENV"; set +o allexport

# ── Log in ────────────────────────────────────────────────────────────────────
oc login --token="$OC_TOKEN" --server="$OC_SERVER" 2>/dev/null
oc project "$OC_PROJECT" 2>/dev/null

# ── Find the postgres pod ─────────────────────────────────────────────────────
POD=$(oc get pod -l app=knowledgebase-postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "$POD" ]]; then
  echo "ERROR: No knowledgebase-postgres pod found in project $OC_PROJECT."
  echo "       Is the cluster running? Try: oc get pods"
  exit 1
fi

# ── Dump ──────────────────────────────────────────────────────────────────────
OUTFILE="$REPO_ROOT/kb_backup_$(date +%Y%m%d_%H%M%S).sql"

echo ""
echo "▶ Dumping database from pod $POD..."
oc exec "$POD" -- pg_dump -U postgres vector > "$OUTFILE"

echo "  ✓ Saved to: $OUTFILE"

# ── Prune old backups — keep only the new file + the one before it ────────────
# Sort existing backups oldest-first; delete everything except the last two.
mapfile -t OLD_BACKUPS < <(ls -t "$REPO_ROOT"/kb_backup_*.sql 2>/dev/null)
# Index 0 = newest (just written), 1 = previous (keep), 2+ = delete
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
echo "To restore on a new cluster after running deploy.sh:"
echo "  POD=\$(oc get pod -l app=knowledgebase-postgres -o jsonpath='{.items[0].metadata.name}')"
echo "  oc exec -i \$POD -- psql -U postgres vector < $OUTFILE"
echo ""
