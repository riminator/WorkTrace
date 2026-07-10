"""
sync_from_supabase.py — One-time reverse sync: Supabase Postgres → in-cluster Postgres.

Pulls time_entries rows that exist in Supabase but are missing from the in-cluster DB
(upsert on id so it is safe to re-run).  Useful after deploying to a new cluster to
catch up any entries logged via the Vercel app since the last SQL dump.

Does NOT touch documents — those live only in-cluster (embeddings can't round-trip
through Supabase).

Usage (locally via oc exec, or as a one-off Job):
  python -m kb.sync_from_supabase

Required env vars:
  DATABASE_URL      — in-cluster Postgres (destination)
  SUPABASE_PG_URL   — Supabase Postgres   (source)
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
log = logging.getLogger("sync_from_supabase")


def _src_conn():
    """Supabase = source."""
    url = os.environ.get("SUPABASE_PG_URL", "")
    if not url:
        raise RuntimeError("SUPABASE_PG_URL is not set.")
    return psycopg2.connect(url, sslmode="require")


def _dst_conn():
    """In-cluster Postgres = destination."""
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL is not set.")
    return psycopg2.connect(url, sslmode="disable")


def _sync_time_entries(src, dst) -> int:
    # Fetch all time_entries from Supabase
    with src.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM time_entries ORDER BY entry_date")
        rows = cur.fetchall()

    if not rows:
        log.info("time_entries: 0 rows in Supabase — nothing to sync.")
        return 0

    log.info("time_entries: %d rows found in Supabase — upserting into in-cluster DB.", len(rows))

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
    log.info("time_entries: upserted %d row(s) into in-cluster DB.", len(rows))
    return len(rows)


def main() -> None:
    log.info("=== Supabase → in-cluster sync started ===")

    try:
        src = _src_conn()
        dst = _dst_conn()
    except Exception as exc:
        log.error("Failed to connect: %s", exc)
        sys.exit(1)

    try:
        _sync_time_entries(src, dst)
    except Exception as exc:
        log.error("Sync failed: %s", exc)
        sys.exit(1)
    finally:
        src.close()
        dst.close()

    log.info("=== Sync complete ===")


if __name__ == "__main__":
    main()
