# KnowledgeBase

A local knowledge base that ingests any file type, embeds with **Ollama + pgvector**, and exposes a **React + FastAPI** frontend for uploading and searching documents.

## Project layout

```
KnowledgeBase/
├── backend/              Python API + ingestion engine
│   ├── api.py            FastAPI app (upload / search / sources)
│   ├── kb/               Core library
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── embedder.py
│   │   ├── extractors.py
│   │   ├── ingest.py
│   │   └── search.py
│   ├── requirements.txt
│   └── setup.py
├── frontend/             React + Vite UI
│   └── src/
│       ├── components/
│       │   ├── Search.jsx
│       │   ├── Upload.jsx
│       │   └── Sources.jsx
│       ├── api.js
│       └── App.jsx
├── sample_docs/          Sample files for testing
└── docker-compose.yml    pgvector container
```

## Quick start

### 1. Start pgvector (already running)
```bash
docker compose up -d
```

### 2. Start the API
```bash
cd backend
pip install -e .
uvicorn api:app --reload --port 8000
```

### 3. Start the frontend
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

## CLI (optional)
```bash
cd backend
kb init
kb ingest /path/to/docs
kb search "your question"
kb list
```
