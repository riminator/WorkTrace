# Starting KnowledgeBase

Run each step in a separate terminal tab.

## 1. pgvector (Docker)

```bash
docker compose up -d
```

## 2. Ollama

```bash
ollama serve
```

In another terminal, pull the embedding model if you haven't already:

```bash
ollama pull nomic-embed-text
```

## 3. FastAPI backend

```bash
cd backend
uvicorn api:app --host 0.0.0.0 --port 8000
```

## 4. Frontend

```bash
cd frontend
npm run dev
```

---

- Frontend → http://localhost:5173
- API docs → http://localhost:8000/docs
- pgvector → localhost:5433
- Ollama → http://localhost:11434

## Stopping

- Frontend / backend / Ollama: `Ctrl+C` in each terminal
- pgvector: `docker compose stop`
