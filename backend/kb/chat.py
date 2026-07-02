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

import re
from dataclasses import dataclass

from kb.config import RAG_TOP_K
from kb.llm import get_provider
from kb.search import SearchResult, get_most_recent_meeting_date, search
from kb.ttt import is_ttt_query, query_ttt

SYSTEM_PROMPT = """\
You are a helpful assistant with access to a personal knowledge base and a \
Time Task Tracker (TTT) database of logged work entries.
Answer the user's question using ONLY the context passages provided below.
If the answer is not in the context, say you don't have that information.
Cite the source (filename or "Time Task Tracker") when relevant.

Important: When the user asks about their "last meeting", "latest meeting", \
"most recent meeting", or asks to "summarize" a meeting, the Time Task Tracker \
context already contains the most recent meeting entry with its title, date, \
project, duration, and description notes. Use ALL of that information to write \
a proper summary — expand the bullet-point notes into clear sentences. \
Do NOT just repeat the meeting title. Do NOT say you lack information if the \
TTT entry has a description; use it.

Context:
{context}
"""

# ── temporal intent detection ────────────────────────────────────────────────

_TEMPORAL_PATTERNS = re.compile(
    r"\b(last|latest|most recent|recent|newest|previous|before)\b.{0,40}\b(meeting|standup|stand-up|call|sync|session)s?\b"
    r"|\b(meeting|standup|stand-up|call|sync|session)s?\b.{0,40}\b(last|latest|most recent|recent|newest|previous|before)\b"
    r"|\b(summarize|summarise|recap|summary of).{0,40}\b(meeting|standup|stand-up|call|sync|session)s?\b"
    r"|\b(meeting|standup|stand-up|call|sync|session)s?\b.{0,40}\b(summary|recap|summarize|summarise)\b",
    re.IGNORECASE,
)


def _is_temporal_meeting_query(question: str) -> bool:
    """Return True if the question asks about the most recent / last meeting."""
    return bool(_TEMPORAL_PATTERNS.search(question))


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
    skip_ttt: bool = False,
    user_id: str | None = None,
) -> ChatResponse:
    """
    Run the RAG pipeline for a single question.

    Args:
        question:      The user's latest question.
        history:       Prior turns (excluding the current question).
        top_k:         Number of chunks to retrieve.
        source_filter: Optional substring filter on source path.
        file_type:     Optional file type filter.
        user_id:       Supabase user UUID — scopes retrieval to this user only.

    Returns:
        ChatResponse with the LLM answer and retrieved source metadata.
    """
    # 1. Retrieve relevant chunks
    results: list[SearchResult] = search(
        question, top_k=top_k, file_type=file_type, source_filter=source_filter, user_id=user_id
    )

    # 1b. Temporal intent — if the user asks about "last/latest/recent meeting",
    #     find the most-recent meeting date and bubble those chunks to the front.
    if _is_temporal_meeting_query(question):
        most_recent_date = get_most_recent_meeting_date(user_id=user_id)
        if most_recent_date:
            # Partition: chunks from the most-recent meeting first, rest after
            primary = [r for r in results if r.doc_metadata.get("meeting_date") == most_recent_date]
            secondary = [r for r in results if r.doc_metadata.get("meeting_date") != most_recent_date]
            results = primary + secondary
            # If we got no semantic hits for the most-recent meeting, fetch more
            if not primary:
                extra = search(
                        question,
                        top_k=top_k * 2,
                        file_type=file_type,
                        source_filter=source_filter,
                        user_id=user_id,
                    )
                primary = [r for r in extra if r.doc_metadata.get("meeting_date") == most_recent_date]
                secondary = [r for r in extra if r.doc_metadata.get("meeting_date") != most_recent_date]
                results = (primary + secondary)[:top_k]

    # 1c. TTT query — fetch structured time-entry data when relevant.
    # Temporal meeting queries (last meeting, last N meetings) always pull the
    # TTT meeting list so the LLM has full history, not just what's in the
    # vector KB.
    # skip_ttt=True is used during meeting summarization to avoid injecting
    # unrelated historical entries into the summary context.
    ttt_context = ""
    if not skip_ttt:
        if _is_temporal_meeting_query(question):
            ttt_context = query_ttt(question, force_meetings=True, user_id=user_id)
        elif is_ttt_query(question):
            ttt_context = query_ttt(question, user_id=user_id)

    # 2. Build context block — TTT results first (structured), then vector chunks
    context_parts = []
    if ttt_context:
        context_parts.append(ttt_context)
    for i, r in enumerate(results, 1):
        fname = r.source.split("/")[-1]
        date_label = f", date {r.doc_metadata['meeting_date']}" if r.doc_metadata.get("meeting_date") else ""
        context_parts.append(
            f"[{i}] {fname} (chunk {r.chunk_index}{date_label}, score {r.score:.3f}):\n{r.content}"
        )
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
