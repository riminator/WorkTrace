# WorkTrace on IKS

Deploy WorkTrace to **IBM Cloud Kubernetes Service (IKS)** for a permanent, stable URL
that never changes and never expires — unlike TechZone clusters.

## Why IKS instead of TechZone OCP

| | TechZone OCP | IKS Free |
|---|---|---|
| Cluster expiry | Every 2–4 weeks | **Never** |
| URL stability | Changes every renewal | **Fixed forever** |
| Storage for 50 users | Fine while alive | **20 GB PVC, no overage** |
| Monthly cost | $0 | **$0** |
| Renewal maintenance | Every month | **None** |

## Prerequisites

1. **IBM Cloud account** (Pay-As-You-Go — free IKS cluster requires billing enabled, no charges apply)
2. **ibmcloud CLI** — `curl -fsSL https://clis.cloud.ibm.com/install/osx | sh`
3. **ibmcloud ks plugin** — `ibmcloud plugin install container-service`
4. **kubectl** — available via Docker Desktop or `brew install kubectl`
5. **docker + docker buildx** — already required by the existing deploy

## First-time setup

```bash
# 1. Log into IBM Cloud
ibmcloud login --sso

# 2. Create a free IKS cluster (takes ~10 min)
ibmcloud ks cluster create classic --name worktrace --zone dal10 --flavor free

# 3. Copy and fill in the deploy config
cp iks/deploy.env.example iks/deploy.env
# Only change needed: confirm IKS_CLUSTER_NAME=worktrace (already set in example)

# 4. Dump current TechZone data (while cluster is still alive)
./openshift/dump.sh

# 5. Deploy — builds images, applies manifests, restores DB dump automatically
./iks/deploy.sh
```

The script prints the permanent URL at the end, e.g.:
```
https://worktrace.dal10.containers.appdomain.cloud
```

## Post-deploy (one time only)

Update these 3 places with the URL printed by `deploy.sh`:

**1. Supabase** — Authentication → URL Configuration:
- Site URL: `https://<your-ingress-subdomain>`
- Redirect URLs: `https://<your-ingress-subdomain>/**`

**2. Outlook sync plist** — update `--worktrace-url` in
`scripts/com.worktrace.outlooksync.plist`, then reload:
```bash
launchctl unload ~/Library/LaunchAgents/com.worktrace.outlooksync.plist
launchctl load   ~/Library/LaunchAgents/com.worktrace.outlooksync.plist
```

**3. Bob MCP server** — update `WORKTRACE_URL` in `~/.bob/settings/mcp.json`

You never need to touch these again.

## Redeploying after a code change

Same as before — build images and roll:

```bash
./iks/deploy.sh
```

Or to just restart without rebuilding images:
```bash
ibmcloud ks cluster config --cluster worktrace
kubectl rollout restart deployment/knowledgebase-backend deployment/knowledgebase-frontend
```

## Dumping the database

```bash
./iks/dump.sh
# Creates kb_backup_YYYYMMDD_HHMMSS.sql in the repo root
```

## Rollback to TechZone OCP

The entire `openshift/` folder is untouched. To go back:

```bash
# 1. Dump current IKS data
./iks/dump.sh

# 2. Get a new TechZone cluster, update openshift/deploy.env with new OC_SERVER + OC_TOKEN

# 3. Run the original deploy — auto-restores from the latest dump
./openshift/deploy.sh
```

## File layout

```
iks/
├── deploy.sh           ← one-command deploy (ibmcloud ks + kubectl)
├── dump.sh             ← dump DB to local SQL file
├── deploy.env.example  ← copy to deploy.env and fill in
├── backend.yaml        ← FastAPI deployment + ClusterIP service (identical to openshift/)
├── postgres.yaml       ← pgvector StatefulSet + 20 Gi PVC (ibmc-block-gold)
├── frontend.yaml       ← nginx deployment + ClusterIP + Ingress (replaces OCP Route)
├── backup-cronjob.yaml ← nightly pg_dump CronJob
└── sync-cronjob.yaml   ← nightly in-cluster → Supabase sync CronJob
```

## Key differences from openshift/

| File | Change |
|---|---|
| `frontend.yaml` | `Route` → standard K8s `Ingress` with IBM-provided TLS |
| `postgres.yaml` | `storageClassName: ibmc-block-gold`, 20 Gi PVC, removed OCP `anyuid` SCC |
| `backup-cronjob.yaml` | `storageClassName: ibmc-block-gold`, removed `serviceAccountName` |
| `deploy.sh` | `oc login` → `ibmcloud ks cluster config`; `oc apply` → `kubectl apply` |
| `dump.sh` | `oc exec` → `kubectl exec` |
