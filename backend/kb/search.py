"""
Semantic search over the knowledge base using pgvector cosine similarity.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select, text

from kb.db import Document, get_session, init_db
from kb.embedder import embed

# Characters of context shown around the best-matching sentence window
_SNIPPET_WINDOW = 300


def _extract_snippet(content: str, query: str, window: int = _SNIPPET_WINDOW) -> str:
    """
    Return a short excerpt from *content* centred on the best matching region.

    Strategy:
      1. Tokenise the query into non-trivial terms (≥3 chars).
      2. Score every character position by how many distinct terms appear
         within a sliding *window*-char window.
      3. Return the window with the highest score, trimmed to sentence/word
         boundaries where possible.  Falls back to the start of the content
         when no terms match at all.
    """
    if not content:
        return content

    # Build list of unique, lowercase terms (skip stop-words shorter than 3 chars)
    stop = {"the", "and", "for", "are", "was", "its", "with", "that", "this",
            "from", "have", "has", "had", "not", "but", "they", "you", "can"}
    terms = list({
        t.lower() for t in re.findall(r"[a-zA-Z0-9]+", query)
        if len(t) >= 3 and t.lower() not in stop
    })

    lower = content.lower()

    if not terms:
        # No meaningful terms — return the first window chars
        return _trim_to_boundary(content, 0, window)

    # Find all match positions for each term
    matches: list[int] = []
    for term in terms:
        for m in re.finditer(re.escape(term), lower):
            matches.append(m.start())

    if not matches:
        return _trim_to_boundary(content, 0, window)

    matches.sort()

    # Slide over match positions and find the window that covers the most
    # distinct terms in the fewest characters
    best_start = matches[0]
    best_score = 0
    n = len(matches)
    j = 0
    for i in range(n):
        while j < n and matches[j] - matches[i] < window:
            j += 1
        # matches[i..j-1] all fall within a window starting at matches[i]
        # score = number of distinct terms covered
        covered = len({
            t for t in terms
            if any(matches[i] <= pos < matches[i] + window
                   and lower[pos:pos + len(t)] == t
                   for pos in matches[i:j])
        })
        if covered > best_score:
            best_score = covered
            best_start = matches[i]

    return _trim_to_boundary(content, best_start, window)


def _trim_to_boundary(text: str, start: int, window: int) -> str:
    """
    Trim a *window*-char slice starting near *start* to clean word/sentence
    boundaries and add ellipsis markers where text was cut.
    """
    total = len(text)
    # Push start back slightly so the matching term isn't right at the edge
    start = max(0, start - 60)

    end = min(total, start + window)

    # Snap start forward to the next sentence or word boundary
    prefix = ""
    if start > 0:
        # Try to start after a sentence-ending punctuation
        m = re.search(r"[.!?]\s+", text[start:start + 80])
        if m:
            start = start + m.end()
        else:
            # Fall back to next whitespace
            m = re.search(r"\s", text[start:start + 40])
            if m:
                start = start + m.end()
        prefix = "…"

    end = min(total, start + window)

    # Snap end back to the last sentence or word boundary
    suffix = ""
    if end < total:
        m = re.search(r"[.!?]", text[max(start, end - 80):end])
        if m:
            end = max(start, end - 80) + m.end()
        else:
            m = re.search(r"\s\S*$", text[start:end])
            if m:
                end = start + m.start()
        suffix = "…"

    return prefix + text[start:end].strip() + suffix


@dataclass
class SearchResult:
    id: int
    source: str
    file_type: str
    chunk_index: int
    content: str
    snippet: str   # short relevant excerpt from content
    score: float   # cosine similarity (1.0 = identical)
    doc_metadata: dict = field(default_factory=dict)


def search(
    query: str,
    *,
    top_k: int = 5,
    file_type: str | None = None,
    source_filter: str | None = None,
) -> list[SearchResult]:
    """
    Embed *query* with Ollama and return the *top_k* most similar chunks.

    Args:
        query:         Natural-language search query.
        top_k:         Number of results to return.
        file_type:     Optional filter — only return chunks from this file type
                       (e.g. ``"pdf"``, ``"image"``).
        source_filter: Optional substring filter on the source file path.
    """
    init_db()
    query_vector = embed(query)

    session = get_session()
    try:
        # pgvector cosine distance operator: <=>
        # similarity = 1 - cosine_distance
        distance_col = Document.embedding.cosine_distance(query_vector).label("distance")

        stmt = (
            select(Document, distance_col)
            .order_by(distance_col)
            .limit(top_k)
        )

        if file_type:
            stmt = stmt.where(Document.file_type == file_type)
        if source_filter:
            stmt = stmt.where(Document.source.ilike(f"%{source_filter}%"))

        rows = session.execute(stmt).all()

        return [
            SearchResult(
                id=row.Document.id,
                source=row.Document.source,
                file_type=row.Document.file_type,
                chunk_index=row.Document.chunk_index,
                content=row.Document.content,
                snippet=_extract_snippet(row.Document.content, query),
                score=round(1.0 - float(row.distance), 4),
                doc_metadata=row.Document.doc_metadata or {},
            )
            for row in rows
        ]
    finally:
        session.close()


def get_most_recent_meeting_date() -> str | None:
    """
    Return the ISO-8601 date string of the most recently indexed meeting,
    or None if no meetings with a parsed date are in the database.
    """
    init_db()
    session = get_session()
    try:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT doc_metadata->>'meeting_date' AS meeting_date
                FROM documents
                WHERE doc_metadata->>'meeting_date' IS NOT NULL
                ORDER BY doc_metadata->>'meeting_date' DESC
                LIMIT 1
                """
            )
        ).all()
        return rows[0].meeting_date if rows else None
    finally:
        session.close()


def list_sources() -> list[dict]:
    """Return a summary of every unique source file currently in the database."""
    init_db()
    session = get_session()
    try:
        rows = session.execute(
            text(
                """
                SELECT source, file_type, COUNT(*) AS chunks
                FROM documents
                GROUP BY source, file_type
                ORDER BY source
                """
            )
        ).all()
        return [{"source": r.source, "file_type": r.file_type, "chunks": r.chunks} for r in rows]
    finally:
        session.close()


def delete_source(source: str) -> int:
    """Delete all chunks for a given *source* path. Returns rows deleted."""
    init_db()
    session = get_session()
    try:
        deleted = session.query(Document).filter(Document.source == source).delete()
        session.commit()
        return deleted
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
