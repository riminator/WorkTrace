# OpenShift Deployment

Everything in this folder is self-contained. The rest of the repo (Render config, local
docker-compose, `.env` files) is untouched.

## Folder contents

```
openshift/
├── Dockerfile.backend    # FastAPI image (built from ./backend)
├── Dockerfile.frontend   # Vite build → nginx image (built from ./frontend)
├── nginx.conf            # nginx SPA config — port 8080, proxies /api/* to backend
├── secret.yaml           # OpenShift Secret template (fill in before applying)
├── backend.yaml          # Deployment + ClusterIP Service for the API
├── frontend.yaml         # Deployment + ClusterIP Service + Route for the UI
└── README.md             # This file
```

## How it works

```
Browser → OpenShift Route (HTTPS)
        → frontend pod (nginx :8080)
          → serves static Vite build
          → proxies /api/* → backend Service (ClusterIP :8000)
                           → FastAPI pod
                             → Supabase (auth + Postgres, external)
                             → Nomic / watsonx (external)
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
  ./frontend
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

## Render hosting is unaffected

The files in this folder have no effect on Render. The existing `render.yaml` and `backend/`
source files are unchanged. Both deployment targets can coexist.
