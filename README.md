# WorkTrace

A document and meeting intelligence platform. Upload any file, ask questions in natural language, and automatically log meeting summaries to a time tracker — all running on OpenShift with in-cluster PostgreSQL + pgvector.

## Features

| Feature | Description |
|---|---|
| **Multi-format ingestion** | PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML, images (OCR), source code |
| **Semantic search** | pgvector cosine similarity — find content by meaning, not keywords |
| **RAG chat** | Multi-turn conversational Q&A grounded in your documents |
| **Meeting intelligence** | Ingest transcripts, auto-extract metadata, generate summaries |
| **Agentic meeting summariser** | 5-step agent loop: search KB → look up TTT history → classify → synthesise → push; full reasoning trace visible in the UI |
| **Chat feedback loop** | Thumbs up/down on every response; approval score dashboard; low-rated query log for iterative improvement |
| **Time Task Tracker** | Meeting summaries auto-pushed to `time_entries` — dashboard, reports, CSV export |
| **Multi-user isolation** | Every document and entry scoped to the authenticated Supabase user |
| **Pluggable LLM** | watsonx · OpenAI · Groq · Ollama — switch via one env var |
| **OpenShift deployment** | One script deploys everything — postgres, backend, frontend, secrets |
| **Cluster migration** | `dump.sh` + `deploy.sh` auto-restore — move to a new cluster in minutes |

---

## Project layout

```
WorkTrace/
├── backend/                  FastAPI backend + ingestion engine
│   ├── api.py                REST API (upload / search / chat / sources / meetings)
│   ├── ttt_api.py            Time Task Tracker routes (/ttt/*)
│   ├── kb/                   Core library
│   │   ├── auth.py           Supabase JWT validation (ES256 + HS256)
│   │   ├── chat.py           RAG pipeline — retrieve → prompt → LLM
│   │   ├── config.py         All env-var config in one place
│   │   ├── db.py             SQLAlchemy engine + Document ORM model
│   │   ├── embedder.py       Nomic / Ollama embedding
│   │   ├── extractors.py     File parsing + chunking (800 chars, 100 overlap)
│   │   ├── ingest.py         Ingest orchestrator with dedup + force re-index
│   │   ├── llm.py            LLM provider abstraction (watsonx / OpenAI / Ollama)
│   │   ├── pusher.py         TTT push — write meeting entries to time_entries
│   │   ├── search.py         Cosine search + list/delete sources
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

## OpenShift deploy (production)

See [`openshift/QUICKSTART.md`](openshift/QUICKSTART.md) for the full guide.

**First time:**
```bash
cp openshift/deploy.env.example openshift/deploy.env
# Fill in: OC_SERVER, OC_TOKEN, Supabase keys, POSTGRES_PASSWORD, watsonx/Groq keys
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

---

## Local development

```bash
# 1. Start pgvector
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env   # fill in values
pip install -e .
uvicorn api:app --reload --port 8000

# 3. Frontend
cd frontend
cp .env.example .env.local   # set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

- Frontend → http://localhost:5173
- API docs → http://localhost:8000/docs

---

## Architecture

```
Browser → OpenShift Route (HTTPS)
        → frontend pod (nginx :8080)
          → serves Vite build
          → proxies /api/* → backend ClusterIP :8000
                           → FastAPI pod
                             → in-cluster pgvector (Ceph RBD PVC)
                             → Supabase (auth only)
                             → Nomic (embeddings)
                             → watsonx / Groq (LLM)
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
