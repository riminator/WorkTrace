import os
import pathlib
from dotenv import load_dotenv

# 1. Explicit override via KB_ENV_FILE env var
# 2. Current working directory .env
# 3. The hard-coded project root (works when installed with `pip install -e .`)
_PROJECT_ROOT = pathlib.Path("/Users/akshaymallireddy/KnowledgeBase")
_candidates = [
    os.environ.get("KB_ENV_FILE"),
    pathlib.Path.cwd() / ".env",
    _PROJECT_ROOT / ".env",
]
for _candidate in _candidates:
    if _candidate and pathlib.Path(_candidate).exists():
        load_dotenv(_candidate, override=False)
        break

DATABASE_URL: str = os.environ["DATABASE_URL"]

# ── Embeddings ────────────────────────────────────────────────────────────────
# EMBED_PROVIDER: "ollama" (local) | "zhipu" (cloud)
EMBED_PROVIDER: str = os.getenv("EMBED_PROVIDER", "ollama")

# Ollama embed (local)
OLLAMA_HOST: str = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_EMBED_MODEL: str = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# Zhipu embed (cloud) — embedding-3 supports dimensions param
ZHIPU_API_KEY: str = os.getenv("ZHIPU_API_KEY", "")
ZHIPU_EMBED_MODEL: str = os.getenv("ZHIPU_EMBED_MODEL", "embedding-3")

# Must match whichever embed model is active:
#   nomic-embed-text  → 768   (Ollama)
#   embedding-3       → 768   (Zhipu, reduced via dimensions param)
EMBED_DIMENSIONS: int = int(os.getenv("EMBED_DIMENSIONS", "768"))

# ── Chat / RAG ────────────────────────────────────────────────────────────────
# LLM_PROVIDER: "ollama" (local) | "openai" (any OpenAI-spec API incl. Zhipu)
LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "ollama")

# Ollama chat model (must be pulled: ollama pull llama3.2)
OLLAMA_CHAT_MODEL: str = os.getenv("OLLAMA_CHAT_MODEL", "llama3.2")

# OpenAI-compatible settings — works for GLM-4 (Zhipu), Groq, OpenAI, etc.
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_CHAT_MODEL: str = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")

# RAG settings
RAG_TOP_K: int = int(os.getenv("RAG_TOP_K", "5"))
