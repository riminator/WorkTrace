# WorkTrace

A document and meeting intelligence platform. Upload any file, ask questions in natural language, and automatically log meeting summaries to a time tracker — running on OpenShift with in-cluster PostgreSQL + pgvector, with a Vercel frontend and daily Supabase backup sync.

## Features

| Feature | Description |
|---|---|
| **Multi-format ingestion** | PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML, images (OCR), source code |
| **Semantic search** | pgvector cosine similarity — find content by meaning, not keywords |
| **RAG chat** | Multi-turn conversational Q&A grounded in your documents |
| **Meeting intelligence** | Ingest transcripts, auto-extract metadata, generate summaries |
| **Agentic meeting summariser** | 5-step agent loop: search KB → look up TTT history → classify → synthesise → push; full reasoning trace visible in the UI |
| **LangChain pipeline** | Optional drop-in replacement for the RAG and agentic pipelines — activate with `USE_LANGCHAIN=true`; custom implementation kept as fallback |
| **ML meeting classifier** | Zero-shot LLM classifier assigns `projectCode`, `taskType`, and `billable` from any meeting title — activate with `USE_LLM_CLASSIFY=true`; regex rules kept as silent fallback |
| **Chat feedback loop** | Thumbs up/down on every response; approval score dashboard; low-rated query log for iterative improvement |
| **Time Task Tracker** | Meeting summaries auto-pushed to `time_entries` — dashboard, reports, CSV export |
| **Multi-user isolation** | Every document and entry scoped to the authenticated Supabase user |
| **Pluggable LLM** | watsonx · OpenAI · Groq · Ollama — switch via one env var |
| **OpenShift deployment** | One script deploys everything — postgres, backend, frontend, secrets, sync cronjob |
| **Cluster migration** | `dump.sh` + `deploy.sh` auto-restore — move to a new cluster in minutes |
| **Daily Supabase sync** | Nightly CronJob mirrors time entries, document metadata, and chat feedback to Supabase Postgres — data survives cluster expiry |
| **Vercel frontend** | Frontend deployable to Vercel — points to Render backend for a fully cluster-independent setup |

---

## Project layout

```
WorkTrace/
├── backend/                  FastAPI backend + ingestion engine
│   ├── api.py                REST API (upload / search / chat / sources / meetings)
│   ├── ttt_api.py            Time Task Tracker routes (/ttt/*)
│   ├── kb/                   Core library
│   │   ├── auth.py           Supabase JWT validation (ES256 + HS256)
│   │   ├── chat.py           RAG pipeline — retrieve → prompt → LLM (routes to LC when USE_LANGCHAIN=true)
│   │   ├── classifier.py     Zero-shot LLM meeting classifier (activated by USE_LLM_CLASSIFY=true)
│   │   ├── config.py         All env-var config in one place (incl. USE_LANGCHAIN, USE_LLM_CLASSIFY flags)
│   │   ├── db.py             SQLAlchemy engine + Document ORM model
│   │   ├── embedder.py       Nomic / Ollama embedding
│   │   ├── extractors.py     File parsing + chunking (800 chars, 100 overlap)
│   │   ├── ingest.py         Ingest orchestrator with dedup + force re-index
│   │   ├── llm.py            LLM provider abstraction (watsonx / OpenAI / Ollama)
│   │   ├── lc_embedder.py    LangChain Embeddings wrapper (activated by USE_LANGCHAIN=true)
│   │   ├── lc_llm.py         LangChain chat model factory
│   │   ├── lc_chat.py        LCEL RAG chain — drop-in for chat.py
│   │   ├── lc_agent.py       LangChain AgentExecutor — drop-in for agentic pipeline
│   │   ├── pusher.py         TTT push — write meeting entries to time_entries
│   │   ├── search.py         Cosine search + list/delete sources
│   │   ├── sync_supabase.py  Daily sync script — OCP Postgres → Supabase Postgres
│   │   └── ttt.py            TTT query layer for RAG context
│   └── requirements.txt
├── frontend/                 React + Vite SPA
│   └── src/
│       ├── components/
│       │   ├── Chat.jsx          Multi-turn RAG chat with source citations + feedback buttons
│       │   ├── Search.jsx        Semantic search with filters + snippet cards
│       │   ├── Upload.jsx        Multi-file dropzone with per-file status
│       │   ├── Sources.jsx       Indexed file inventory with delete
│       │   ├── MeetingUpload.jsx Meeting ingestion — Standard RAG or Agentic mode with trace panel
│       │   ├── FeedbackStats.jsx Chat feedback dashboard (approval score, low-rated query log)
│       │   ├── TTTDashboard.jsx  Time tracking dashboard + charts
│       │   ├── TTTEntries.jsx    Time entry list with filters
│       │   ├── TTTManualEntry.jsx Manual time entry form
│       │   ├── TTTImport.jsx     CSV / ICS calendar import
│       │   └── TTTReports.jsx    Reports + CSV export
│       ├── api.js            Fetch wrappers for all backend routes
│       ├── tttApi.js         TTT-specific fetch helpers
│       ├── supabaseClient.js Supabase auth client
│       └── App.jsx           Tab shell — KB tabs + TTT tabs
├── openshift/                OpenShift deployment
│   ├── deploy.sh             ← one-command deploy (see Quickstart)
│   ├── dump.sh               ← dump DB before cluster expires
│   ├── deploy.env.example    Secrets template — copy to deploy.env
│   ├── QUICKSTART.md         Step-by-step cluster deploy guide
│   ├── postgres.yaml         pgvector StatefulSet + Ceph RBD PVC
│   ├── backend.yaml          FastAPI Deployment + ClusterIP Service
│   ├── frontend.yaml         nginx Deployment + Service + Route
│   ├── backup-cronjob.yaml   Daily pg_dump CronJob → keeps 7 local backups on a PVC
│   ├── sync-cronjob.yaml     Daily sync CronJob → mirrors data to Supabase Postgres
│   ├── secret.yaml           Secret template (reference only)
│   ├── Dockerfile.backend    Backend image
│   ├── Dockerfile.frontend   Frontend image (Vite build → nginx)
│   └── nginx.conf            nginx SPA config — proxies /api/* to backend
├── recorder/                 macOS meeting recorder (optional)
│   ├── teams_recorder.py     ffmpeg capture → Whisper transcription → ingest
│   └── README.md
├── sample_docs/              Sample files for testing
├── docker-compose.yml        Local pgvector container (dev only)
└── docs/                     Architecture + feature docs
```

---

## Deployments

WorkTrace runs in two complementary deployment modes:

| Layer | Service | Notes |
|---|---|---|
| **Frontend** | Vercel | Deployed from `frontend/` — set env vars in Vercel dashboard |
| **Backend API** | Render | `https://knowledgebase-ttt.onrender.com` — always-on, free tier |
| **Vector DB** | OCP in-cluster pgvector | Ceph RBD PVC — primary store for documents + embeddings |
| **Backup DB** | Supabase Postgres | Nightly sync of time entries, document metadata, chat feedback |
| **Auth** | Supabase | Magic link · Google OAuth · GitHub OAuth |

### Vercel frontend setup

Set these three environment variables in the **Vercel dashboard** (Settings → Environment Variables):

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://knowledgebase-ttt.onrender.com` |
| `VITE_SUPABASE_URL` | `https://iauelxumvcwsndypnmhb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | *(anon key from Supabase dashboard)* |

Then in **Supabase → Authentication → URL Configuration**:
- **Site URL** → your Vercel app URL
- **Redirect URLs** → `https://your-app.vercel.app/**`

### OpenShift deploy

See [`openshift/QUICKSTART.md`](openshift/QUICKSTART.md) for the full guide.

**First time:**
```bash
cp openshift/deploy.env.example openshift/deploy.env
# Fill in: OC_SERVER, OC_TOKEN, Supabase keys, POSTGRES_PASSWORD, SUPABASE_PG_URL, watsonx/Groq keys
oc adm policy add-scc-to-user anyuid -z postgres-sa -n knowledgebase
./openshift/deploy.sh
```

**New cluster (after expiry):**
```bash
# 1. Before expiry — dump data
./openshift/dump.sh

# 2. Update token in deploy.env
OC_SERVER=https://api.new-cluster.com:6443
OC_TOKEN=sha256~new-token

# 3. Deploy — auto-restores backup
./openshift/deploy.sh
```

### Daily Supabase sync

A CronJob (`sync-cronjob.yaml`) runs at **02:00 UTC** every night. It mirrors three tables from in-cluster Postgres to Supabase:

- `time_entries` — full upsert on `id`
- `documents_meta` — text + metadata only (no embedding vectors; works on Supabase free plan)
- `chat_feedback` — full upsert on `id`

To trigger manually:
```bash
oc create job supabase-sync-manual --from=cronjob/worktrace-supabase-sync
oc logs -f job/supabase-sync-manual
```

---

## Local development

```bash
# 1. Start pgvector
docker compose up -d

# 2. Backend
cd backend
cp ../.env.example .env   # fill in values
pip install -e .
uvicorn api:app --reload --port 8000

# 3. Frontend
cd frontend
cp .env.example .env.local   # set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + VITE_API_URL
npm install
npm run dev
```

- Frontend → http://localhost:5173
- API docs → http://localhost:8000/docs

---

## Architecture

```
Browser (Vercel)
  → React SPA
    → VITE_API_URL = https://knowledgebase-ttt.onrender.com  (Render backend)
                   OR
    → VITE_API_URL = /api  (OCP nginx proxy → in-cluster backend)

OCP cluster:
  Route (HTTPS)
    → frontend pod (nginx :8080)
      → serves Vite build
      → proxies /api/* → backend ClusterIP :8000
                       → FastAPI pod
                         → in-cluster pgvector (Ceph RBD PVC)
                         → Supabase (auth only)
                         → Nomic (embeddings)
                         → watsonx / Groq (LLM)

Nightly CronJob (02:00 UTC):
  OCP Postgres → sync_supabase.py → Supabase Postgres
```

### Ingest pipeline
```
File upload → extract text → chunk (800 chars / 100 overlap)
           → embed (Nomic) → store in pgvector documents table
```

### RAG chat pipeline
```
Question → embed → cosine search (pgvector) → top-K chunks
        → [optional TTT context] → build prompt → LLM → answer + sources
        → [optional thumbs up/down feedback stored in chat_feedback table]
```

### Agentic meeting pipeline
```
Transcript (already ingested) →
  1. search_kb      (retrieve transcript chunks)
  2. lookup_ttt     (past entries for the same project)
  3. classify       (infer project, task type, billable)
  4. synthesise     (LLM call with all context)
  5. push_ttt       (insert time entry)
→ answer + full reasoning trace
```

---

## LLM providers

Switch by setting `LLM_PROVIDER` in `deploy.env` (or `.env` locally):

| Provider | Config |
|---|---|
| **watsonx** | `LLM_PROVIDER=watsonx` + `WATSONX_API_KEY` + `WATSONX_PROJECT_ID` + `WATSONX_MODEL_ID` |
| **Groq** | `LLM_PROVIDER=openai` + `OPENAI_API_KEY=gsk_...` + `OPENAI_BASE_URL=https://api.groq.com/openai/v1` + `OPENAI_CHAT_MODEL=llama-3.1-8b-instant` |
| **OpenAI** | `LLM_PROVIDER=openai` + `OPENAI_API_KEY=sk-...` |
| **Ollama** (local) | `LLM_PROVIDER=ollama` + `OLLAMA_HOST` + `OLLAMA_CHAT_MODEL` |

---

## LangChain pipeline (optional)

WorkTrace ships with an optional LangChain pipeline that can replace the custom RAG and agentic implementations. The custom code is always kept as a fallback.

Set `USE_LANGCHAIN=true` in `deploy.env` (or `.env` locally) to activate it:

| Mode | `USE_LANGCHAIN=false` (default) | `USE_LANGCHAIN=true` |
|---|---|---|
| RAG chat | Hand-rolled prompt + `WatsonxProvider.chat()` | LCEL pipe: `ChatPromptTemplate \| ChatWatsonx \| StrOutputParser` |
| Agentic meeting | Fixed 5-step sequence (always runs all steps) | `AgentExecutor` — LLM dynamically decides which tools to call and how many times |
| Retrieval | Same `search()` + `query_ttt()` calls | Same (unchanged) |
| Embeddings | Direct Nomic/Ollama HTTP calls | Same calls wrapped in `LCNomicEmbeddings` / `LCOllamaEmbeddings` |

---

## ML meeting classifier (optional)

WorkTrace includes a zero-shot LLM classifier for meeting entries. When enabled it replaces the built-in regex rules in `_classify()` with a structured LLM call that infers `projectCode`, `taskType`, and `billable` from any meeting title. On any error it falls back to the regex rules silently.

Set `USE_LLM_CLASSIFY=true` in `deploy.env` (or `.env` locally) to activate it:

| Field | Regex (default) | LLM classifier |
|---|---|---|
| `projectCode` | Pattern-matched keywords only | Inferred from full title semantics |
| `taskType` | 4 hard-coded patterns | Full vocabulary: `standup`, `planning`, `review`, `admin`, `learning`, etc. |
| `billable` | Keyword list (`client`, `customer`, …) | Context-aware inference |
| `confidence` | Fixed value (0.2–0.85) | Model self-reported (0.0–1.0) |

See [`backend/kb/classifier_README.md`](backend/kb/classifier_README.md) for the full prompt, fallback behaviour, and testing instructions.

---

## Supported file types

| Category | Formats |
|---|---|
| Documents | PDF · DOCX · DOC · TXT · MD · RST |
| Data | CSV · JSON · YAML · XML · HTML |
| Code | PY · JS · TS · GO · JAVA · C · C++ · RB · SH |
| Images | PNG · JPG · JPEG · GIF · BMP · TIFF · WEBP (OCR) |
| Meetings | TXT · MD · VTT · SRT · PDF · DOCX with structured header |

---

## Meeting transcript format

Transcripts with a structured header are auto-parsed for metadata:

```
Date: 2025-01-15
Meeting Title: Sprint Review
Organizer: jane@example.com
Attendees: Alice, Bob, Carol
Project Code: PROJ-42
Duration: 45 minutes
Billable: Yes
Platform: Teams

[transcript content below...]
```
