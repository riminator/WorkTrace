"""
Semantic search over the knowledge base using pgvector cosine similarity.
"""
from __future__ import annotations

from dataclasses import dataclass

from pgvector.sqlalchemy import Vector
from sqlalchemy import func, select, text

from kb.db import Document, get_session, init_db
from kb.embedder import embed


@dataclass
class SearchResult:
    id: int
    source: str
    file_type: str
    chunk_index: int
    content: str
    score: float  # cosine similarity (1.0 = identical)


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
                score=round(1.0 - float(row.distance), 4),
            )
            for row in rows
        ]
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
