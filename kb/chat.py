"""
RAG chat pipeline.

Flow:
  1. Embed the user question (Ollama nomic-embed-text)
  2. Retrieve top-K chunks from pgvector via cosine similarity
  3. Build a system prompt with the retrieved context
  4. Call the configured LLM provider and return the answer

The conversation history is passed in by the caller so the LLM has
multi-turn context (the KB retrieval always uses only the latest question).
"""
from __future__ import annotations

from dataclasses import dataclass

from kb.config import RAG_TOP_K
from kb.llm import get_provider
from kb.search import SearchResult, search

SYSTEM_PROMPT = """\
You are a helpful assistant with access to a personal knowledge base.
Answer the user's question using ONLY the context passages provided below.
If the answer is not in the context, say you don't have that information.
Be concise and cite the source filename when relevant.

Context:
{context}
"""


@dataclass
class ChatMessage:
    role: str   # "user" | "assistant"
    content: str


@dataclass
class ChatResponse:
    answer: str
    sources: list[dict]  # [{"source": str, "score": float, "chunk_index": int}]


def ask(
    question: str,
    history: list[ChatMessage] | None = None,
    *,
    top_k: int = RAG_TOP_K,
    source_filter: str | None = None,
    file_type: str | None = None,
) -> ChatResponse:
    """
    Run the RAG pipeline for a single question.

    Args:
        question:      The user's latest question.
        history:       Prior turns (excluding the current question).
        top_k:         Number of chunks to retrieve.
        source_filter: Optional substring filter on source path.
        file_type:     Optional file type filter.

    Returns:
        ChatResponse with the LLM answer and retrieved source metadata.
    """
    # 1. Retrieve relevant chunks
    results: list[SearchResult] = search(
        question, top_k=top_k, file_type=file_type, source_filter=source_filter
    )

    # 2. Build context block
    context_parts = []
    for i, r in enumerate(results, 1):
        fname = r.source.split("/")[-1]
        context_parts.append(f"[{i}] {fname} (chunk {r.chunk_index}, score {r.score:.3f}):\n{r.content}")
    context = "\n\n".join(context_parts) if context_parts else "No relevant documents found."

    # 3. Build messages
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT.format(context=context)},
    ]
    for turn in (history or []):
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": question})

    # 4. Call LLM
    llm = get_provider()
    answer = llm.chat(messages)

    sources = [
        {"source": r.source, "score": r.score, "chunk_index": r.chunk_index}
        for r in results
    ]
    return ChatResponse(answer=answer, sources=sources)
