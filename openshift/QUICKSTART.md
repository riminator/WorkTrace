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
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string → Session pooler |
| `TTT_DATABASE_URL` | Same as above (can be same project) |
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret |
| `NOMIC_API_KEY` | [atlas.nomic.ai](https://atlas.nomic.ai) → API keys |
| `WATSONX_API_KEY` | IBM Cloud → watsonx.ai → Manage → API key |
| `WATSONX_PROJECT_ID` | watsonx.ai → project → Manage → General |

`deploy.env` is gitignored — it will never be committed.

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

That's it. The script will:
- Build and push both Docker images (multi-arch amd64 + arm64)
- Log into the cluster and set up the project
- Apply all secrets
- Deploy backend and frontend
- Wait for both pods to be `Running`
- Print the app URL

---

## After deploy — one manual step

The script prints your new URL at the end. Go to **Supabase → Authentication → URL Configuration** and update:

- **Site URL** → `https://<your-route-host>`
- **Redirect URLs** → `https://<your-route-host>/**`

Without this, login redirects will fail.

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
```
