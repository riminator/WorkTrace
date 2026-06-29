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

import logging
import os
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import kb.config as _config  # noqa: F401 — ensures .env is loaded via config's load_dotenv

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

# ── helpers ───────────────────────────────────────────────────────────────────

_DURATION_RE = re.compile(r"(\d+)\s*(?:minute|min|m)\b", re.IGNORECASE)
_HOURS_RE    = re.compile(r"(\d+(?:\.\d+)?)\s*(?:hour|hr|h)\b", re.IGNORECASE)

# Matches "10:00 AM", "14:30", "2:45 PM" etc.
_TIME_RE = re.compile(r"(\d{1,2}:\d{2})\s*(AM|PM)?", re.IGNORECASE)

# Common timezone abbreviation → IANA mapping
_TZ_MAP = {
    "CST": "America/Chicago",
    "CDT": "America/Chicago",
    "EST": "America/New_York",
    "EDT": "America/New_York",
    "MST": "America/Denver",
    "MDT": "America/Denver",
    "PST": "America/Los_Angeles",
    "PDT": "America/Los_Angeles",
    "UTC": "UTC",
}


def _parse_time_range(time_str: str, entry_date: date) -> tuple[datetime | None, datetime | None]:
    """
    Parse a time range string like "10:00 AM – 10:30 AM CST" or "14:00 – 14:45"
    into (start_time, end_time) aware datetimes using entry_date as the date part.
    Returns (None, None) if parsing fails.
    """
    # Extract timezone abbreviation
    tz = timezone.utc
    for abbr, iana in _TZ_MAP.items():
        if abbr in time_str.upper():
            try:
                tz = ZoneInfo(iana)
            except ZoneInfoNotFoundError:
                pass
            break

    times = _TIME_RE.findall(time_str)
    if not times:
        return None, None

    def _to_dt(hhmm: str, ampm: str | None) -> datetime | None:
        try:
            fmt = "%I:%M %p" if ampm else "%H:%M"
            t_str = f"{hhmm} {ampm.upper()}" if ampm else hhmm
            t = datetime.strptime(t_str, fmt)
            return datetime(entry_date.year, entry_date.month, entry_date.day,
                            t.hour, t.minute, tzinfo=tz)
        except ValueError:
            return None

    start = _to_dt(*times[0]) if len(times) >= 1 else None
    end   = _to_dt(*times[1]) if len(times) >= 2 else None
    return start, end


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
    meeting_time: str | None = None,
    duration_minutes: float | None = None,
    project_code: str | None = None,
    organizer: str | None = None,
    attendees: str | None = None,
    billable: bool = False,
) -> dict:
    """
    Insert one row into TTT's time_entries table.

    Returns the inserted row as a dict, or raises on failure.

    Args:
        filename:         Meeting title (from header) or filename fallback.
        summary:          Full LLM-generated summary text.
        entry_date:       Date of the meeting (defaults to today).
        duration_minutes: From header or auto-parsed from summary.
        project_code:     From header, request, or parsed from summary.
        organizer:        From header or request.
        attendees:        From header or request.
        billable:         From header Billable field (default False).
    """
    today    = entry_date or date.today()
    duration = duration_minutes if duration_minutes is not None else _parse_duration_minutes(summary)
    project  = project_code or _parse_project(summary, filename)

    start_time: datetime | None = None
    end_time:   datetime | None = None
    if meeting_time:
        start_time, end_time = _parse_time_range(meeting_time, today)

    row = {
        "id":               str(uuid.uuid4()),
        "project_code":     project,
        "task_type":        "meeting",
        "duration_minutes": duration,
        "entry_date":       today.isoformat(),
        "start_time":       start_time,
        "end_time":         end_time,
        "description":      summary,
        "meeting_title":    filename,
        "billable":         billable,
        "confidence":       0.75,
        "status":           "logged",
        "organizer":        organizer,
        "attendees":        attendees,
    }

    sql = """
        INSERT INTO time_entries
            (id, project_code, task_type, duration_minutes, entry_date,
             start_time, end_time,
             description, meeting_title, billable, confidence, status,
             organizer, attendees)
        VALUES
            (%(id)s, %(project_code)s, %(task_type)s, %(duration_minutes)s,
             %(entry_date)s, %(start_time)s, %(end_time)s,
             %(description)s, %(meeting_title)s,
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
