"""
Embedding provider abstraction.

Providers:
  OllamaEmbedder  — local Ollama (default, EMBED_PROVIDER=ollama)
  ZhipuEmbedder   — Zhipu AI cloud API (EMBED_PROVIDER=zhipu)

Both return a list[float] of length EMBED_DIMENSIONS (default 768).

Usage:
  from kb.embedder import embed, embed_batch
  vector = embed("some text")

To switch providers, set in .env:
  # Cloud (Zhipu):
  EMBED_PROVIDER=zhipu
  ZHIPU_API_KEY=your_key
  EMBED_DIMENSIONS=768

  # Local (Ollama):
  EMBED_PROVIDER=ollama
  OLLAMA_EMBED_MODEL=nomic-embed-text
  EMBED_DIMENSIONS=768
"""
from __future__ import annotations

import abc

import httpx

from kb.config import (
    EMBED_DIMENSIONS,
    EMBED_PROVIDER,
    OLLAMA_EMBED_MODEL,
    OLLAMA_HOST,
    ZHIPU_API_KEY,
    ZHIPU_EMBED_MODEL,
)

_TIMEOUT = httpx.Timeout(120.0)


# ── Base ──────────────────────────────────────────────────────────────────────

class BaseEmbedder(abc.ABC):
    @abc.abstractmethod
    def embed(self, text: str) -> list[float]: ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [self.embed(t) for t in texts]


# ── Ollama (local) ────────────────────────────────────────────────────────────

class OllamaEmbedder(BaseEmbedder):
    """Calls Ollama /api/embed directly via httpx (HTTP/1.1 forced)."""

    def __init__(self) -> None:
        self._url = f"{OLLAMA_HOST.rstrip('/')}/api/embed"
        self._model = OLLAMA_EMBED_MODEL
        self._headers = {"Connection": "close"}

    def embed(self, text: str) -> list[float]:
        resp = httpx.post(
            self._url,
            json={"model": self._model, "input": text},
            timeout=_TIMEOUT,
            headers=self._headers,
        )
        resp.raise_for_status()
        return resp.json()["embeddings"][0]


# ── Zhipu (cloud) ─────────────────────────────────────────────────────────────

class ZhipuEmbedder(BaseEmbedder):
    """
    Calls Zhipu AI embedding-3 API.
    Passes `dimensions=EMBED_DIMENSIONS` so output matches the pgvector table
    (default 768, same as nomic-embed-text — no re-indexing needed when switching).

    Docs: https://open.bigmodel.cn/dev/api/vector/embedding-3
    """

    _URL = "https://open.bigmodel.cn/api/paas/v4/embeddings"

    def __init__(self) -> None:
        if not ZHIPU_API_KEY:
            raise RuntimeError("ZHIPU_API_KEY is not set. Add it to your .env.")
        self._headers = {
            "Authorization": f"Bearer {ZHIPU_API_KEY}",
            "Content-Type": "application/json",
        }
        self._model = ZHIPU_EMBED_MODEL
        self._dims = EMBED_DIMENSIONS

    def embed(self, text: str) -> list[float]:
        resp = httpx.post(
            self._URL,
            json={"model": self._model, "input": text, "dimensions": self._dims},
            headers=self._headers,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]


# ── Factory ───────────────────────────────────────────────────────────────────

def get_embedder() -> BaseEmbedder:
    provider = EMBED_PROVIDER.lower()
    if provider == "ollama":
        return OllamaEmbedder()
    if provider == "zhipu":
        return ZhipuEmbedder()
    raise ValueError(f"Unknown EMBED_PROVIDER '{provider}'. Choices: ollama, zhipu")


# ── Public helpers (backwards-compatible) ─────────────────────────────────────

def embed(text: str) -> list[float]:
    return get_embedder().embed(text)


def embed_batch(texts: list[str]) -> list[list[float]]:
    return get_embedder().embed_batch(texts)
