"""
lc_llm.py — LangChain chat model factory.

Returns the appropriate langchain_* ChatModel based on LLM_PROVIDER,
mirroring the provider choices in kb/llm.py.

Activated when USE_LANGCHAIN=true.
"""
from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel

from kb.config import (
    LLM_PROVIDER,
    OLLAMA_CHAT_MODEL,
    OLLAMA_HOST,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_CHAT_MODEL,
    WATSONX_API_KEY,
    WATSONX_MODEL_ID,
    WATSONX_PROJECT_ID,
    WATSONX_URL,
)


def get_lc_llm() -> BaseChatModel:
    """Return the configured LangChain chat model."""
    provider = LLM_PROVIDER.lower()

    if provider == "watsonx":
        from langchain_ibm import ChatWatsonx
        return ChatWatsonx(
            model_id=WATSONX_MODEL_ID,
            url=WATSONX_URL,
            project_id=WATSONX_PROJECT_ID,
            apikey=WATSONX_API_KEY,
            params={"max_new_tokens": 600, "temperature": 0},
        )

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=OPENAI_CHAT_MODEL or "gpt-4o-mini",
            api_key=OPENAI_API_KEY,
            base_url=OPENAI_BASE_URL or None,
            temperature=0,
        )

    if provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=OLLAMA_CHAT_MODEL,
            base_url=OLLAMA_HOST,
            temperature=0,
        )

    raise ValueError(f"Unknown LLM_PROVIDER '{provider}' for LangChain mode.")
