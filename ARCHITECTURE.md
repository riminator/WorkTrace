# KnowledgeBase — Architecture & File Reference

## Running Services

| Service | Port | Runtime | Role |
|---|---|---|---|
| **pgvector** | 5433 | Docker | Vector database — stores document chunks + 768-dim embeddings |
| **Ollama** | 11434 | Native | Runs `nomic-embed-text` (embeddings) + `llama3.2` (chat) |
| **FastAPI** | 8000 | Python / uvicorn | REST API — upload, search, chat, sources |
| **Vite / React** | 5173 | Node | Frontend SPA |

---

## Pipeline 1 — Document Ingest

```
File Input (UI / CLI / Recorder)
    → POST /upload  (backend/api.py)
    → tempfile on disk
    → extractors.py  — auto-detect type, split into 800-char / 100-overlap chunks
    → embedder.py    — httpx → Ollama /api/embed → 768-dim vector per chunk
    → ingest.py      — upsert Document row
    → pgvector       — documents table, Vector(768)
```

**Supported formats:** PDF · DOCX · TXT / MD / CSV / JSON / YAML / HTML · PNG / JPG / GIF (OCR via Tesseract) · PY / JS / TS / Go / Java / C / C++ · any binary (ASCII fallback)

**Skip logic:** already-indexed sources are skipped unless `force=true`

---

## Pipeline 2 — RAG Chat

```
User question  (Chat.jsx, multi-turn history)
    → POST /chat  (backend/api.py)
    → kb/chat.py ask()   — RAG orchestrator
    → embedder.py        — embed the question
    → search.py          — cosine distance (<=>) · top-K chunks from pgvector
    → Build prompt       — system + context chunks + conversation history + question
    → llm.py get_provider()
          OllamaProvider  → Ollama /api/chat  (llama3.2)
          OpenAIProvider  → any OpenAI-spec API (GPT-4o, GLM-4, Groq, …)
    → ChatResponseOut { answer, sources[] }
    → Chat.jsx           — render bubbles + collapsible source citations
```

---

## Pipeline 3 — Semantic Search (no LLM)

```
Search.jsx  (query + filters)
    → POST /search  (backend/api.py)
    → embedder.py   — embed query
    → pgvector      — cosine distance top-K
    → SearchResultOut[]  — rendered as highlighted snippet cards in UI
```

---

## Pipeline 4 — Teams Meeting Recorder

```
.venv/bin/python recorder/teams_recorder.py --record
    → ffmpeg + BlackHole  — capture system audio → ~/recordings/teams_YYYYMMDD_HHMMSS.wav
    → Ctrl+C              — flush WAV headers, stop recording
    → Whisper             — transcribe locally → .txt with timestamps
    → POST /upload        — feeds into Ingest Pipeline above
```

Files saved to `~/recordings/`. Auto-detect mode also available (polls for Teams UDP connections).

---

## Important File Locations

### Configuration

| Path | Description |
|---|---|
| `.env` | Primary config — `DATABASE_URL`, `OLLAMA_HOST`, `OLLAMA_EMBED_MODEL`, `EMBED_DIMENSIONS`, `LLM_PROVIDER`, `OLLAMA_CHAT_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_CHAT_MODEL`, `RAG_TOP_K` |
| `.env.example` | Template for `.env`. Safe to commit. |
| `backend/.env` | Backend-specific env override (same vars). |
| `recorder/.env` | Recorder settings — `KB_INGEST_URL`, `WHISPER_MODEL`, `AUDIO_DEVICE`, `RECORDINGS_DIR`, `POLL_INTERVAL` |
| `frontend/.env.local` | Vite env — set `VITE_API_URL` to change API base URL |

### Infrastructure

| Path | Description |
|---|---|
| `docker-compose.yml` | `kb_pgvector` container — pgvector:pg16, port `5433→5432`, named volume `pgvector_data` |
| `START.md` | Commands to start all four services in separate terminals |
| `requirements.txt` | Root Python deps — used by `setup.py` to install the `kb` CLI |
| `setup.py` | Installs package + registers `kb` CLI entry point |
| `sample_docs/` | Sample files for testing. Run `kb ingest sample_docs/` |
| `.logs/backend.log` | uvicorn stdout/stderr |
| `.logs/ollama.log` | Ollama serve stdout/stderr |

### Core Library — `kb/`

> All files are mirrored at `backend/kb/`. Keep them in sync when editing.

| Path | Description |
|---|---|
| `kb/config.py` | Loads `.env`, exports all config constants. Single source of truth. |
| `kb/db.py` | SQLAlchemy engine, `SessionLocal`, `Document` ORM model (`documents` table, `Vector(768)`). `init_db()` creates extension + table. |
| `kb/embedder.py` | `embed(text) → list[float]`. Calls Ollama `/api/embed` via httpx (HTTP/1.1 forced to avoid connection-reuse bugs). |
| `kb/extractors.py` | Auto-detects file type → splits into 800-char / 100-overlap chunks. PDF, DOCX, OCR images, plaintext, source code, binary fallback. |
| `kb/ingest.py` | Ingest orchestrator: walk files → extract → embed → upsert. Skips already-indexed unless `force=True`. Rich progress bar. |
| `kb/search.py` | `search()` — embed query → pgvector `<=>` cosine distance → top-K. Also `list_sources()`, `delete_source()`. |
| `kb/chat.py` | RAG pipeline. `ask(question, history)` → retrieve chunks → build prompt → call LLM → `ChatResponse(answer, sources)`. |
| `kb/llm.py` | LLM provider abstraction. `BaseLLMProvider` ABC → `OllamaProvider` + `OpenAIProvider`. Switch via `LLM_PROVIDER` in `.env`. To add a new provider: subclass `BaseLLMProvider`, implement `chat()`, register in `get_provider()`. |
| `kb/cli.py` | Click CLI: `kb init` · `kb ingest <path>` · `kb search <query>` · `kb list` · `kb delete <source>` |

### Backend — `backend/`

| Path | Description |
|---|---|
| `backend/api.py` | FastAPI app. `POST /upload` · `POST /search` · `GET /sources` · `DELETE /sources` · `POST /chat`. CORS open. Runs `init_db()` on startup. |
| `backend/kb/` | Mirror of root `kb/`. Backend imports from here. |
| `backend/requirements.txt` | Backend Python deps (fastapi, uvicorn, psycopg2, pgvector, sqlalchemy, httpx, …) |

### Frontend — `frontend/src/`

| Path | Description |
|---|---|
| `frontend/src/App.jsx` | Root component. 4-tab shell: **Chat** (default) · Search · Upload · Sources |
| `frontend/src/App.css` | All global + component styles. CSS custom properties for theming. |
| `frontend/src/api.js` | Fetch wrappers: `searchDocs()` · `uploadFile()` · `getSources()` · `deleteSource()` · `chatWithKB()` |
| `frontend/src/components/Chat.jsx` | Chat UI — message history, user/assistant bubbles, collapsible source citations, "Thinking…" state |
| `frontend/src/components/Search.jsx` | Semantic search form — file type filter, source filter, top-K, highlighted snippet cards |
| `frontend/src/components/Upload.jsx` | react-dropzone multi-file queue — per-file status, force re-index option |
| `frontend/src/components/Sources.jsx` | Table of indexed files — source path, type, chunk count, delete per row |

### Recorder — `recorder/`

| Path | Description |
|---|---|
| `recorder/teams_recorder.py` | macOS meeting recorder. `--record`: start immediately, Ctrl+C to stop + transcribe + ingest. `--transcribe-only <wav>`: process existing file. No flag: auto-detect Teams calls. |
| `recorder/.env` | Recorder config (see above) |
| `~/recordings/` | Output: `teams_YYYYMMDD_HHMMSS.wav` + `.txt` per session |

---

## Switching LLM Provider

Everything is config-driven — no code changes needed.

**To use GLM-4:**
```
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_CHAT_MODEL=glm-4-flash
```

**To add a brand-new provider:**
1. Subclass `BaseLLMProvider` in `kb/llm.py` and implement `chat()`
2. Register it in `get_provider()` with a name string
3. Set `LLM_PROVIDER=<name>` in `.env`
