import os
import pathlib
from dotenv import load_dotenv

# 1. Explicit override via KB_ENV_FILE env var
# 2. Current working directory .env
# 3. Parent of this file (works when installed with `pip install -e .`)
_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
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
# EMBED_PROVIDER: "ollama" (local) | "nomic" (cloud, free)
EMBED_PROVIDER: str = os.getenv("EMBED_PROVIDER", "ollama")

# Ollama embed (local)
OLLAMA_HOST: str = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_EMBED_MODEL: str = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# Nomic embed (cloud, free) — nomic-embed-text-v1.5 outputs 768 dims natively
NOMIC_API_KEY: str = os.getenv("NOMIC_API_KEY", "")
NOMIC_EMBED_MODEL: str = os.getenv("NOMIC_EMBED_MODEL", "nomic-embed-text-v1.5")

# Must match whichever embed model is active (both default to 768)
EMBED_DIMENSIONS: int = int(os.getenv("EMBED_DIMENSIONS", "768"))

# ── Chat / RAG ────────────────────────────────────────────────────────────────
# LLM_PROVIDER: "ollama" (local) | "openai" (any OpenAI-spec API incl. Groq) | "watsonx"
LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "ollama")

# Ollama chat model (must be pulled: ollama pull llama3.2)
OLLAMA_CHAT_MODEL: str = os.getenv("OLLAMA_CHAT_MODEL", "llama3.2")

# OpenAI-compatible settings — works for Groq, OpenAI, etc.
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
OPENAI_CHAT_MODEL: str = os.getenv("OPENAI_CHAT_MODEL", "llama-3.1-8b-instant")

# watsonx.ai settings
WATSONX_API_KEY: str = os.getenv("WATSONX_API_KEY", "")
WATSONX_URL: str = os.getenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com")
WATSONX_PROJECT_ID: str = os.getenv("WATSONX_PROJECT_ID", "")
WATSONX_MODEL_ID: str = os.getenv("WATSONX_MODEL_ID", "meta-llama/llama-3-3-70b-instruct")

# RAG settings
RAG_TOP_K: int = int(os.getenv("RAG_TOP_K", "5"))

# ── Time Task Tracker ─────────────────────────────────────────────────────────
TTT_DATABASE_URL: str = os.getenv("TTT_DATABASE_URL", "")
TTT_PGSSL: bool = os.getenv("TTT_PGSSL", "true").lower() == "true"
