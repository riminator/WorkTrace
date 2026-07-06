#!/bin/bash
# start.sh — starts all KnowledgeBase services in background
# Usage: ./start.sh        (start)
#        ./start.sh stop   (stop all)

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv/bin/activate"
LOGS="$ROOT/.logs"
PIDS="$ROOT/.pids"

mkdir -p "$LOGS" "$PIDS"

stop_all() {
  echo "Stopping services..."
  for f in "$PIDS"/*.pid; do
    [ -f "$f" ] || continue
    pid=$(cat "$f")
    name=$(basename "$f" .pid)
    if kill "$pid" 2>/dev/null; then
      echo "  stopped $name (pid $pid)"
    fi
    rm -f "$f"
  done
  echo "Done."
  exit 0
}

[ "$1" = "stop" ] && stop_all

echo "Starting KnowledgeBase..."

# 1. pgvector (Docker)
echo "  → pgvector (Docker)"
docker-compose up -d >> "$LOGS/docker.log" 2>&1 &

# 2. Backend (FastAPI)
echo "  → FastAPI backend (port 8000)"
source "$VENV"
cd "$ROOT/backend"
nohup uvicorn api:app --host 0.0.0.0 --port 8000 \
  >> "$LOGS/backend.log" 2>&1 &
echo $! > "$PIDS/backend.pid"
cd "$ROOT"

# 3. Frontend (Vite)
echo "  → Vite frontend (port 5173)"
cd "$ROOT/frontend"
nohup npm run dev -- --host \
  >> "$LOGS/frontend.log" 2>&1 &
echo $! > "$PIDS/frontend.pid"

echo ""
echo "All services started."
echo "  Frontend  → http://localhost:5173"
echo "  API docs  → http://localhost:8000/docs"
echo ""
echo "Logs in .logs/   |   Stop with: ./start.sh stop"
