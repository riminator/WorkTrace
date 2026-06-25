"""
pusher.py — push a meeting summary to the Time Task Tracker (TTT).

After a meeting file is ingested and summarised via the RAG pipeline,
call push_meeting_entry() to insert a row into the TTT's time_entries table
on Neon (or any Postgres reachable via TTT_DATABASE_URL).

Required env vars (add to .env):
    TTT_DATABASE_URL   — Neon connection string for the TTT DB
    TTT_APP_PASSWORD   — X-App-Password value (used only if pushing via HTTP;
                         not needed for direct DB insert)

The insert is fire-and-forget from the ingest endpoint's perspective —
failures are logged but never surface as a 500 to the caller.
"""
from __future__ import annotations

import json
import logging
import os

import kb.config as _config  # noqa: F401 — ensures .env is loaded via config's load_dotenv
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

# ── helpers ───────────────────────────────────────────────────────────────────

_DURATION_RE = re.compile(r"(\d+)\s*(?:minute|min|m)\b", re.IGNORECASE)
_HOURS_RE    = re.compile(r"(\d+(?:\.\d+)?)\s*(?:hour|hr|h)\b", re.IGNORECASE)


def _parse_duration_minutes(text: str) -> float:
    """Best-effort extraction of a duration in minutes from LLM output."""
    minutes = 0.0
    for m in _HOURS_RE.finditer(text):
        minutes += float(m.group(1)) * 60
    for m in _DURATION_RE.finditer(text):
        minutes += float(m.group(1))
    return minutes or 60.0   # default 60 min if nothing found


def _parse_project(text: str, filename: str) -> str:
    """
    Try to extract a project code from the LLM summary.
    Falls back to the filename stem (uppercased, first word).
    """
    # Look for lines like "Project: Honda" or "Project Code: ACME"
    m = re.search(r"project(?:\s+code)?[:\s]+([A-Za-z0-9_\-]+)", text, re.IGNORECASE)
    if m:
        return m.group(1).strip().upper()
    # Fallback: first word of filename
    stem = re.split(r"[\s_\-]", filename.rsplit(".", 1)[0])[0]
    return stem.upper() or "GENERAL"


def _get_conn():
    url = os.environ.get("TTT_DATABASE_URL", "")
    if not url:
        raise RuntimeError("TTT_DATABASE_URL is not set in the environment.")
    ssl_required = "sslmode=require" in url or os.environ.get("TTT_PGSSL", "true").lower() == "true"
    kwargs: dict[str, Any] = {"dsn": url}
    if ssl_required:
        kwargs["sslmode"] = "require"
    return psycopg2.connect(**kwargs)


# ── public API ────────────────────────────────────────────────────────────────

def push_meeting_entry(
    *,
    filename: str,
    summary: str,
    entry_date: date | None = None,
    duration_minutes: float | None = None,
    project_code: str | None = None,
    organizer: str | None = None,
    attendees: str | None = None,
) -> dict:
    """
    Insert one row into TTT's time_entries table.

    Returns the inserted row as a dict, or raises on failure.

    Args:
        filename:         Original filename (used as meeting_title and fallback project).
        summary:          Full LLM-generated summary text.
        entry_date:       Date of the meeting (defaults to today).
        duration_minutes: Override duration; auto-parsed from summary if None.
        project_code:     Override project; auto-parsed from summary if None.
        organizer:        Optional organiser email/name.
        attendees:        Optional comma-separated attendee list.
    """
    today = entry_date or date.today()
    duration = duration_minutes if duration_minutes is not None else _parse_duration_minutes(summary)
    project  = project_code or _parse_project(summary, filename)

    row = {
        "id":               str(uuid.uuid4()),
        "project_code":     project,
        "task_type":        "meeting",
        "duration_minutes": duration,
        "entry_date":       today.isoformat(),
        "description":      summary,
        "meeting_title":    filename,
        "billable":         False,
        "confidence":       0.75,
        "status":           "logged",
        "organizer":        organizer,
        "attendees":        attendees,
    }

    sql = """
        INSERT INTO time_entries
            (id, project_code, task_type, duration_minutes, entry_date,
             description, meeting_title, billable, confidence, status,
             organizer, attendees)
        VALUES
            (%(id)s, %(project_code)s, %(task_type)s, %(duration_minutes)s,
             %(entry_date)s, %(description)s, %(meeting_title)s,
             %(billable)s, %(confidence)s, %(status)s,
             %(organizer)s, %(attendees)s)
        ON CONFLICT (id) DO NOTHING
        RETURNING id;
    """

    conn = _get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, row)
                result = cur.fetchone()
                log.info("TTT push ok: id=%s project=%s duration=%.0f min", row["id"], project, duration)
                return dict(result) if result else row
    finally:
        conn.close()
