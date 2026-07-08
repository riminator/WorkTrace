# OpenShift Deployment

Everything needed to run WorkTrace on OpenShift is in this folder.

## Folder contents

```
openshift/
├── deploy.sh             # One-command deploy (build, push, secrets, apply, wait)
├── dump.sh               # Dump in-cluster DB before cluster expiry
├── deploy.env.example    # Secrets template — copy to deploy.env
├── QUICKSTART.md         # Step-by-step guide
├── Dockerfile.backend    # FastAPI image (built from ./backend)
├── Dockerfile.frontend   # Vite build → nginx image (built from repo root)
├── nginx.conf            # nginx SPA config — port 8080, proxies /api/* to backend
├── postgres.yaml         # pgvector StatefulSet + Ceph RBD PVC
├── backend.yaml          # Deployment + ClusterIP Service for the API
├── frontend.yaml         # Deployment + ClusterIP Service + Route for the UI
├── backup-cronjob.yaml   # Daily pg_dump CronJob — keeps 7 backups on a PVC
├── sync-cronjob.yaml     # Daily Supabase sync CronJob — mirrors data off-cluster
├── secret.yaml           # Secret template (reference only — do not commit with values)
└── README.md             # This file
```

## How it works

```
Browser (Vercel or OCP Route)
  → React SPA
    → /api/* proxied by nginx  (OCP mode)
      OR
    → https://knowledgebase-ttt.onrender.com  (Vercel mode)

OCP cluster:
  Route (HTTPS)
    → frontend pod (nginx :8080)
      → serves static Vite build
      → proxies /api/* → backend Service (ClusterIP :8000)
                       → FastAPI pod
                         → in-cluster pgvector (Ceph RBD PVC)
                         → Supabase (auth only, external)
                         → Nomic / watsonx (external)

Nightly CronJob (02:00 UTC):
  in-cluster Postgres → sync_supabase.py → Supabase Postgres
```

The backend is never publicly exposed — only the frontend Route is. All API traffic goes
through nginx inside the cluster.

---

## Step 1 — Fill in the Secret

Edit `openshift/secret.yaml` and replace every placeholder value with your real credentials.
**Do not commit the file with real values.** Use a `.gitignore` entry or a secrets manager.

```bash
# After editing:
oc apply -f openshift/secret.yaml
```

## Step 2 — Build and push the images

Run from the **repo root** (not inside `openshift/`).

```bash
# Choose your registry:
#   OCP internal:  image-registry.openshift-image-registry.svc:5000/<namespace>
#   Quay.io:       quay.io/<your-org>
#   Docker Hub:    docker.io/<your-user>
REGISTRY=quay.io/your-org
NS=knowledgebase   # or oc project -q

# Backend
docker build \
  -f openshift/Dockerfile.backend \
  -t $REGISTRY/knowledgebase-backend:latest \
  ./backend
docker push $REGISTRY/knowledgebase-backend:latest

# Frontend — VITE_API_URL=/api routes all API calls through the nginx proxy
docker build \
  -f openshift/Dockerfile.frontend \
  --build-arg VITE_API_URL=/api \
  -t $REGISTRY/knowledgebase-frontend:latest \
  .
docker push $REGISTRY/knowledgebase-frontend:latest
```

### Using the OCP internal registry

```bash
# Expose the registry (one-time cluster-admin step)
oc patch configs.imageregistry.operator.openshift.io/cluster \
  --type merge -p '{"spec":{"defaultRoute":true}}'

# Log docker into it
REGISTRY_HOST=$(oc get route default-route -n openshift-image-registry \
  -o jsonpath='{.spec.host}')
docker login -u $(oc whoami) -p $(oc whoami -t) $REGISTRY_HOST

# Then use: $REGISTRY_HOST/<namespace>/knowledgebase-backend:latest
# Inside the cluster, reference it as:
#   image-registry.openshift-image-registry.svc:5000/<namespace>/knowledgebase-backend:latest
```

## Step 3 — Update image references

Edit `openshift/backend.yaml` and `openshift/frontend.yaml` — replace the `image:` placeholder
with the full image path you pushed in Step 2.

## Step 4 — Deploy

```bash
oc apply -f openshift/backend.yaml
oc apply -f openshift/frontend.yaml
```

## Step 5 — Get the URL

```bash
oc get route knowledgebase
# NAME             HOST/PORT                                   ...
# knowledgebase    knowledgebase.apps.your-cluster.com         ...
```

Open the HOST in a browser. The app is live.

## Step 6 — Add the URL to Supabase

In the Supabase dashboard for your project:
- **Authentication → URL Configuration → Site URL** → set to your Route URL
- **Authentication → URL Configuration → Redirect URLs** → add your Route URL

Without this, Supabase OAuth redirects will be rejected.

---

## Updating a deployment

```bash
# Rebuild and push the image, then trigger a rollout:
oc rollout restart deployment/knowledgebase-backend
oc rollout restart deployment/knowledgebase-frontend

# Watch rollout status
oc rollout status deployment/knowledgebase-backend
```

## Useful debug commands

```bash
# Pod status
oc get pods

# Logs
oc logs deployment/knowledgebase-backend
oc logs deployment/knowledgebase-frontend

# Exec into the backend pod
oc exec -it deployment/knowledgebase-backend -- /bin/bash

# Check the Route URL
oc get route knowledgebase -o jsonpath='{.spec.host}'

# Update a single secret value without editing the file
oc patch secret knowledgebase-secrets \
  --type merge \
  -p '{"stringData":{"WATSONX_API_KEY":"new-value"}}'
```

---

## Render + Vercel

The files in this folder have no effect on Render or Vercel. Both deployment targets coexist:

- **Render** runs the backend (`https://knowledgebase-ttt.onrender.com`) and uses the same Docker image
- **Vercel** deploys the frontend from `frontend/` — set `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` as environment variables in the Vercel dashboard
