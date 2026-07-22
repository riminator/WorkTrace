"""
lc_chat.py — LangChain LCEL RAG pipeline.

This is the LangChain equivalent of kb/chat.py.  It uses the same underlying
search() and query_ttt() functions for retrieval (no behaviour change there),
but builds the prompt and drives the LLM via LangChain's LCEL pipe rather than
hand-rolled message dicts.

Activated when USE_LANGCHAIN=true in the environment.
The original kb/chat.py is preserved as a fallback.

Pipeline:
  question + history
      │
      ├─► query_ttt()     (if TTT intent detected)     ──┐
      │                                                    ├─► context string
      └─► search()        (pgvector cosine retrieval)  ──┘
                │
                ▼
          ChatPromptTemplate  (system + history + human)
                │
                ▼
          LC chat model  (watsonx / openai / ollama)
                │
                ▼
          StrOutputParser  →  ChatResponse
"""
from __future__ import annotations

from dataclasses import dataclass

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableLambda, RunnablePassthrough

from kb.chat import (
    SYSTEM_PROMPT,
    ChatMessage,
    ChatResponse,
    _is_temporal_meeting_query,
)
from kb.config import RAG_TOP_K
from kb.lc_llm import get_lc_llm
from kb.search import SearchResult, search
from kb.ttt import is_ttt_query, query_ttt


# ── context builder (reuses existing retrieval logic) ─────────────────────────

def _build_context(
    question: str,
    *,
    top_k: int,
    source_filter: str | None,
    file_type: str | None,
    user_id: str | None,
    skip_ttt: bool,
) -> tuple[str, list[SearchResult]]:
    """
    Returns (context_string, results_list).
    Identical retrieval logic to chat.py — only the LLM call differs.
    """
    # When source_filter is set the caller targets a specific file (e.g.
    # /summarize-meeting) — skip the temporal short-circuit so the vector
    # search actually runs against that file.
    is_temporal = _is_temporal_meeting_query(question) and not source_filter

    ttt_context = ""
    if not skip_ttt:
        if is_temporal:
            ttt_context = query_ttt(question, force_meetings=True, user_id=user_id)
        elif is_ttt_query(question):
            ttt_context = query_ttt(question, user_id=user_id)

    results: list[SearchResult] = [] if is_temporal else search(
        question, top_k=top_k, file_type=file_type,
        source_filter=source_filter, user_id=user_id,
    )

    parts = []
    if ttt_context:
        parts.append(ttt_context)
    for i, r in enumerate(results, 1):
        fname = r.source.split("/")[-1]
        date_label = (
            f", date {r.doc_metadata['meeting_date']}"
            if r.doc_metadata.get("meeting_date") else ""
        )
        parts.append(
            f"[{i}] {fname} (chunk {r.chunk_index}{date_label}, score {r.score:.3f}):\n{r.content}"
        )

    context = "\n\n".join(parts) if parts else "No relevant documents found."
    return context, results


# ── LCEL chain builder ────────────────────────────────────────────────────────

def _build_chain():
    """
    Build and return a reusable LCEL chain.

    Input dict keys:  system_context, history (list[BaseMessage]), question
    Output:           str (the LLM's answer)
    """
    prompt = ChatPromptTemplate.from_messages([
        ("system", "{system_context}"),
        MessagesPlaceholder("history"),
        ("human", "{question}"),
    ])
    return prompt | get_lc_llm() | StrOutputParser()


# ── public entry point (mirrors chat.ask signature) ───────────────────────────

def ask(
    question: str,
    history: list[ChatMessage] | None = None,
    *,
    top_k: int = RAG_TOP_K,
    source_filter: str | None = None,
    file_type: str | None = None,
    skip_ttt: bool = False,
    user_id: str | None = None,
) -> ChatResponse:
    """
    LangChain LCEL version of kb.chat.ask().

    Drop-in replacement — same signature and return type.
    """
    context, results = _build_context(
        question,
        top_k=top_k,
        source_filter=source_filter,
        file_type=file_type,
        user_id=user_id,
        skip_ttt=skip_ttt,
    )

    # Convert WorkTrace ChatMessage history → LangChain message objects
    lc_history = []
    for turn in (history or []):
        if turn.role == "user":
            lc_history.append(HumanMessage(content=turn.content))
        else:
            lc_history.append(AIMessage(content=turn.content))

    chain = _build_chain()
    answer = chain.invoke({
        "system_context": SYSTEM_PROMPT.format(context=context),
        "history":        lc_history,
        "question":       question,
    })

    sources = [
        {"source": r.source, "score": r.score, "chunk_index": r.chunk_index}
        for r in results
    ]
    return ChatResponse(answer=answer, sources=sources)
