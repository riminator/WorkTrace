"""
LLM provider abstraction.

Implementations:
  OllamaProvider   — local Ollama (default)
  OpenAIProvider   — OpenAI-compatible API (GPT-4o, GLM-4, etc.)

Usage:
  from kb.llm import get_provider
  llm = get_provider()
  answer = llm.chat(messages)

To add a new provider:
  1. Subclass BaseLLMProvider and implement chat().
  2. Register it in get_provider() below.
  3. Set LLM_PROVIDER=<name> in .env.
"""
from __future__ import annotations

import abc
from typing import Generator

import httpx

from kb.config import OLLAMA_HOST, OLLAMA_CHAT_MODEL, LLM_PROVIDER, OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_CHAT_MODEL


class BaseLLMProvider(abc.ABC):
    @abc.abstractmethod
    def chat(self, messages: list[dict], *, stream: bool = False) -> str | Generator[str, None, None]:
        """
        Send a list of OpenAI-style messages and return the assistant reply.

        Args:
            messages: [{"role": "system"|"user"|"assistant", "content": "..."}]
            stream:   If True, yield text chunks instead of returning a full string.
        """


# ── Ollama ────────────────────────────────────────────────────────────────────

class OllamaProvider(BaseLLMProvider):
    """Calls Ollama's /api/chat endpoint directly via httpx."""

    def __init__(self, model: str = OLLAMA_CHAT_MODEL, host: str = OLLAMA_HOST) -> None:
        self.model = model
        self._url = f"{host.rstrip('/')}/api/chat"

    def chat(self, messages: list[dict], *, stream: bool = False) -> str | Generator[str, None, None]:
        import json
        resp = httpx.post(
            self._url,
            json={"model": self.model, "messages": messages, "stream": stream},
            timeout=httpx.Timeout(120.0),
            headers={"Connection": "close"},
        )
        resp.raise_for_status()

        if not stream:
            return resp.json()["message"]["content"]

        def _gen():
            for line in resp.iter_lines():
                if line:
                    chunk = json.loads(line)
                    delta = chunk.get("message", {}).get("content", "")
                    if delta:
                        yield delta
        return _gen()


# ── OpenAI-compatible (GPT-4o, GLM-4, any OpenAI-spec API) ───────────────────

class OpenAIProvider(BaseLLMProvider):
    """
    Works with any OpenAI-spec API: OpenAI, Azure, GLM-4 (ZhipuAI),
    Together, Groq, Anyscale, etc.

    Set in .env:
        LLM_PROVIDER=openai
        OPENAI_API_KEY=<key>
        OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4  # for GLM-4
        OPENAI_CHAT_MODEL=glm-4-flash
    """

    def __init__(self) -> None:
        self._base = (OPENAI_BASE_URL or "https://api.openai.com/v1").rstrip("/")
        self._model = OPENAI_CHAT_MODEL or "gpt-4o-mini"
        self._headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

    def chat(self, messages: list[dict], *, stream: bool = False) -> str:
        resp = httpx.post(
            f"{self._base}/chat/completions",
            json={"model": self._model, "messages": messages, "stream": False},
            headers=self._headers,
            timeout=httpx.Timeout(120.0),
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


# ── Factory ───────────────────────────────────────────────────────────────────

def get_provider() -> BaseLLMProvider:
    """Return the configured LLM provider instance."""
    provider = LLM_PROVIDER.lower()
    if provider == "ollama":
        return OllamaProvider()
    if provider == "openai":
        return OpenAIProvider()
    raise ValueError(f"Unknown LLM_PROVIDER '{provider}'. Choices: ollama, openai")
