"""
lc_embedder.py — LangChain Embeddings wrappers around WorkTrace's existing
Nomic and Ollama HTTP embedders.

Activated when USE_LANGCHAIN=true.  The underlying HTTP calls are identical
to the custom embedder — we just wrap them in the langchain_core.embeddings
interface so they can be plugged into LangChain chains and retrievers.
"""
from __future__ import annotations

from langchain_core.embeddings import Embeddings

from kb.config import EMBED_PROVIDER
from kb.embedder import NomicEmbedder, OllamaEmbedder


class LCNomicEmbeddings(Embeddings):
    """LangChain wrapper around WorkTrace's NomicEmbedder."""

    def __init__(self) -> None:
        self._embedder = NomicEmbedder()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embedder.embed_batch(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embedder.embed(text)


class LCOllamaEmbeddings(Embeddings):
    """LangChain wrapper around WorkTrace's OllamaEmbedder."""

    def __init__(self) -> None:
        self._embedder = OllamaEmbedder()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embedder.embed_batch(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embedder.embed(text)


def get_lc_embeddings() -> Embeddings:
    """Return the configured LangChain Embeddings instance."""
    provider = EMBED_PROVIDER.lower()
    if provider == "nomic":
        return LCNomicEmbeddings()
    if provider == "ollama":
        return LCOllamaEmbeddings()
    raise ValueError(f"Unknown EMBED_PROVIDER '{provider}' for LangChain mode.")
