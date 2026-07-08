"""
sync_supabase.py — One-way sync from in-cluster Postgres → Supabase Postgres.

Syncs three tables:
  - time_entries     (full rows, upsert on id)
  - documents        (metadata only — no embedding vector, upsert on source+chunk_index+user_id)
  - chat_feedback    (full rows, upsert on id)

Safe to run repeatedly — uses INSERT ... ON CONFLICT DO UPDATE so it only
writes what has changed. Skips the pgvector embedding column entirely so
this works on Supabase's free plan (no pgvector extension needed).

Usage:
  python -m kb.sync_supabase

Required env vars:
  DATABASE_URL      — in-cluster Postgres (source)
  SUPABASE_PG_URL   — Supabase Postgres (destination)
"""
from __future__ import annotations

import logging
import os
import sys

import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sync_supabase")


# ── connection helpers ────────────────────────────────────────────────────────

def _src_conn():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is not set.")
    return psycopg2.connect(url, sslmode="disable")


def _dst_conn():
    url = os.environ.get("SUPABASE_PG_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_PG_URL is not set.")
    return psycopg2.connect(url, sslmode="require")


# ── schema bootstrap ──────────────────────────────────────────────────────────

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS time_entries (
    id               TEXT        PRIMARY KEY,
    user_id          TEXT,
    project_code     TEXT,
    task_type        TEXT,
    duration_minutes NUMERIC,
    entry_date       DATE,
    start_time       TIMESTAMPTZ,
    end_time         TIMESTAMPTZ,
    description      TEXT,
    meeting_title    TEXT,
    billable         BOOLEAN     DEFAULT FALSE,
    confidence       NUMERIC     DEFAULT 0,
    status           TEXT        DEFAULT 'logged',
    organizer        TEXT,
    attendees        TEXT
);

CREATE TABLE IF NOT EXISTS documents_meta (
    id           INTEGER,
    user_id      TEXT,
    source       TEXT        NOT NULL,
    file_type    TEXT,
    chunk_index  INTEGER     NOT NULL DEFAULT 0,
    content      TEXT,
    created_at   TIMESTAMPTZ,
    doc_metadata JSONB,
    PRIMARY KEY (source, chunk_index, user_id)
);

CREATE TABLE IF NOT EXISTS chat_feedback (
    id          TEXT        PRIMARY KEY,
    user_id     TEXT        NOT NULL,
    question    TEXT        NOT NULL,
    answer      TEXT        NOT NULL,
    sources     JSONB       NOT NULL DEFAULT '[]',
    rating      SMALLINT    NOT NULL,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def _ensure_schema(dst):
    with dst.cursor() as cur:
        cur.execute(_SCHEMA_SQL)
    dst.commit()
    log.info("Schema verified on Supabase.")


# ── sync helpers ──────────────────────────────────────────────────────────────

def _sync_time_entries(src, dst) -> int:
    with src.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM time_entries")
        rows = cur.fetchall()

    if not rows:
        log.info("time_entries: 0 rows in source — nothing to sync.")
        return 0

    with dst.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO time_entries
                (id, user_id, project_code, task_type, duration_minutes,
                 entry_date, start_time, end_time, description, meeting_title,
                 billable, confidence, status, organizer, attendees)
            VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                project_code     = EXCLUDED.project_code,
                task_type        = EXCLUDED.task_type,
                duration_minutes = EXCLUDED.duration_minutes,
                entry_date       = EXCLUDED.entry_date,
                start_time       = EXCLUDED.start_time,
                end_time         = EXCLUDED.end_time,
                description      = EXCLUDED.description,
                meeting_title    = EXCLUDED.meeting_title,
                billable         = EXCLUDED.billable,
                confidence       = EXCLUDED.confidence,
                status           = EXCLUDED.status,
                organizer        = EXCLUDED.organizer,
                attendees        = EXCLUDED.attendees
            """,
            [
                (
                    r["id"], r["user_id"], r["project_code"], r["task_type"],
                    r["duration_minutes"], r["entry_date"], r["start_time"],
                    r["end_time"], r["description"], r["meeting_title"],
                    r["billable"], r["confidence"], r["status"],
                    r["organizer"], r["attendees"],
                )
                for r in rows
            ],
        )
    dst.commit()
    log.info("time_entries: synced %d row(s).", len(rows))
    return len(rows)


def _sync_documents_meta(src, dst) -> int:
    # Fetch everything except the embedding vector column
    with src.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, user_id, source, file_type, chunk_index, "
            "content, created_at, doc_metadata FROM documents"
        )
        rows = cur.fetchall()

    if not rows:
        log.info("documents_meta: 0 rows in source — nothing to sync.")
        return 0

    with dst.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO documents_meta
                (id, user_id, source, file_type, chunk_index,
                 content, created_at, doc_metadata)
            VALUES %s
            ON CONFLICT (source, chunk_index, user_id) DO UPDATE SET
                file_type    = EXCLUDED.file_type,
                content      = EXCLUDED.content,
                created_at   = EXCLUDED.created_at,
                doc_metadata = EXCLUDED.doc_metadata
            """,
            [
                (
                    r["id"], r["user_id"] or "", r["source"], r["file_type"],
                    r["chunk_index"], r["content"], r["created_at"],
                    psycopg2.extras.Json(r["doc_metadata"]) if r["doc_metadata"] else None,
                )
                for r in rows
            ],
        )
    dst.commit()
    log.info("documents_meta: synced %d row(s).", len(rows))
    return len(rows)


def _sync_chat_feedback(src, dst) -> int:
    with src.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM chat_feedback")
        rows = cur.fetchall()

    if not rows:
        log.info("chat_feedback: 0 rows in source — nothing to sync.")
        return 0

    with dst.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO chat_feedback
                (id, user_id, question, answer, sources, rating, note, created_at)
            VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                rating     = EXCLUDED.rating,
                note       = EXCLUDED.note
            """,
            [
                (
                    r["id"], r["user_id"], r["question"], r["answer"],
                    psycopg2.extras.Json(r["sources"]) if r["sources"] else psycopg2.extras.Json([]),
                    r["rating"], r["note"], r["created_at"],
                )
                for r in rows
            ],
        )
    dst.commit()
    log.info("chat_feedback: synced %d row(s).", len(rows))
    return len(rows)


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    log.info("=== WorkTrace → Supabase sync started ===")

    try:
        src = _src_conn()
        dst = _dst_conn()
    except Exception as exc:
        log.error("Failed to connect: %s", exc)
        sys.exit(1)

    try:
        _ensure_schema(dst)
        _sync_time_entries(src, dst)
        _sync_documents_meta(src, dst)
        _sync_chat_feedback(src, dst)
    except Exception as exc:
        log.error("Sync failed: %s", exc)
        sys.exit(1)
    finally:
        src.close()
        dst.close()

    log.info("=== Sync complete ===")


if __name__ == "__main__":
    main()
