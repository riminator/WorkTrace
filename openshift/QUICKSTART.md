# OpenShift Quickstart

New cluster reservation? Two steps and you're live.

---

## First time only — create your local secrets file

```bash
cp openshift/deploy.env.example openshift/deploy.env
```

Open `openshift/deploy.env` and fill in:

| Variable | Where to find it |
|---|---|
| `OC_SERVER` | OCP console → top-right → **Copy login command** |
| `OC_TOKEN` | Same as above |
| `OC_PROJECT` | Whatever namespace you want (e.g. `knowledgebase`) |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → **anon public** key |
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret |
| `SUPABASE_PG_URL` | Supabase → Project Settings → Database → Connection string → URI — escape any `$` in the password as `\$` |
| `POSTGRES_PASSWORD` | Choose any strong password for the in-cluster Postgres |
| `NOMIC_API_KEY` | [atlas.nomic.ai](https://atlas.nomic.ai) → API keys |
| `WATSONX_API_KEY` | IBM Cloud → watsonx.ai → Manage → API key |
| `WATSONX_PROJECT_ID` | watsonx.ai → project → Manage → General |
| `USE_LLM_CLASSIFY` | `true` to use zero-shot LLM meeting classifier; `false` (default) uses regex rules |

`deploy.env` is gitignored — it will never be committed.

> **Note on special characters in passwords:** If your password contains `$`, escape it as `\$` in `deploy.env`. The file is sourced by bash, so unescaped `$` will be interpolated.

---

## Every new cluster reservation

**1. Update your login token** in `openshift/deploy.env`:

```
OC_SERVER=https://api.your-new-cluster.com:6443
OC_TOKEN=sha256~your-new-token
```

Get these from the OCP console → top-right menu → **Copy login command**.

**2. Run the deploy script from the repo root:**

```bash
./openshift/deploy.sh
```

The script will:
- Build and push both Docker images (multi-arch amd64 + arm64)
- Log into the cluster and set up the project
- Deploy in-cluster Postgres and auto-restore the latest `kb_backup_*.sql` if one exists
- Apply all secrets (including `SUPABASE_PG_URL` for the sync cronjob)
- Deploy backend, frontend, daily backup CronJob, and daily Supabase sync CronJob
- Wait for both pods to be `Running` and print the app URL

---

## After deploy — one manual step

The script prints your new URL at the end. Go to **Supabase → Authentication → URL Configuration** and update:

- **Site URL** → `https://<your-route-host>`
- **Redirect URLs** → `https://<your-route-host>/**`

Without this, login redirects will fail.

---

## Daily Supabase sync

The deploy script automatically applies `sync-cronjob.yaml`, which runs at **02:00 UTC** every night. It mirrors:

- `time_entries` → Supabase `time_entries`
- `documents` (metadata only, no embeddings) → Supabase `documents_meta`
- `chat_feedback` → Supabase `chat_feedback`

This means your data survives cluster expiry — when you move to a new cluster, your Supabase DB already has everything.

**Trigger a manual sync at any time:**
```bash
oc create job supabase-sync-manual --from=cronjob/worktrace-supabase-sync
oc logs -f job/supabase-sync-manual
```

**Check sync history:**
```bash
oc get jobs -l app=worktrace-supabase-sync
```

---

## Useful commands

```bash
# Check pod status
oc get pods

# View backend logs
oc logs deployment/knowledgebase-backend

# View frontend logs
oc logs deployment/knowledgebase-frontend

# Get the app URL
oc get route knowledgebase -o jsonpath='{.spec.host}'

# Force redeploy without rebuilding images
oc rollout restart deployment/knowledgebase-backend
oc rollout restart deployment/knowledgebase-frontend

# Trigger the Supabase sync manually
oc create job supabase-sync-manual --from=cronjob/worktrace-supabase-sync
oc logs -f job/supabase-sync-manual

# Trigger a manual DB backup
oc create job db-backup-manual --from=cronjob/worktrace-db-backup
oc logs -f job/db-backup-manual

# Patch a single secret value without redeploying
oc patch secret knowledgebase-secrets \
  --type merge \
  -p '{"stringData":{"WATSONX_API_KEY":"new-value"}}'

# Enable the LLM meeting classifier without a full redeploy
oc patch secret knowledgebase-secrets \
  --type merge \
  -p '{"stringData":{"USE_LLM_CLASSIFY":"true"}}'
oc rollout restart deployment/knowledgebase-backend
```
