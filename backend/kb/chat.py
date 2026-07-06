"""
RAG chat pipeline.

Flow:
  1. Embed the user question (Ollama nomic-embed-text)
  2. Retrieve top-K chunks from pgvector via cosine similarity
  3. Build a system prompt with the retrieved context
  4. Call the configured LLM provider and return the answer

The conversation history is passed in by the caller so the LLM has
multi-turn context (the KB retrieval always uses only the latest question).

When USE_LANGCHAIN=true this module delegates to kb/lc_chat.py (LCEL pipeline)
while keeping the custom implementation below as a permanent fallback.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from kb.config import RAG_TOP_K
from kb.llm import get_provider
from kb.search import SearchResult, search
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

Formatting rules — always follow these:
- Use markdown in your responses.
- When listing multiple items (meetings, entries, tasks, etc.), use a markdown \
bullet list (- item) or a table, never a run-on paragraph.
- For each meeting or time entry, present the key details as bullet points \
(e.g. - **Project:** …, - **Duration:** …, - **Summary:** …).
- Use **bold** for labels/headings within a list item.
- Use a markdown table when comparing data across multiple fields.
- Keep prose concise; prefer structured output over long paragraphs.

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

    Routes to the LangChain LCEL pipeline when USE_LANGCHAIN=true,
    otherwise runs the custom hand-rolled pipeline below.

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
    from kb.config import USE_LANGCHAIN
    if USE_LANGCHAIN:
        from kb import lc_chat
        return lc_chat.ask(
            question, history,
            top_k=top_k,
            source_filter=source_filter,
            file_type=file_type,
            skip_ttt=skip_ttt,
            user_id=user_id,
        )

    # 1. Temporal-meeting intent: use ONLY the TTT as the source of truth.
    #    The vector KB can't reliably identify "most recent" — it returns
    #    semantically similar chunks (e.g. a WorkTrace demo PDF) which the LLM
    #    then misidentifies as the last meeting.  Skip the vector search entirely
    #    for these queries and let the TTT context carry the full answer.
    is_temporal = _is_temporal_meeting_query(question)

    ttt_context = ""
    if not skip_ttt:
        if is_temporal:
            ttt_context = query_ttt(question, force_meetings=True, user_id=user_id)
        elif is_ttt_query(question):
            ttt_context = query_ttt(question, user_id=user_id)

    # For temporal meeting queries skip the vector search — TTT is authoritative.
    if is_temporal:
        results: list[SearchResult] = []
    else:
        results = search(
            question, top_k=top_k, file_type=file_type, source_filter=source_filter, user_id=user_id
        )

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
