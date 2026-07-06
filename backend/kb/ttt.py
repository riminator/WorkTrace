"""
ttt.py — Time Task Tracker query layer for the RAG chat pipeline.

Detects time-tracking intent in the user's question and fetches relevant
rows from the TTT ``time_entries`` table, returning them as a formatted
context block that can be merged into the LLM prompt alongside vector-DB
context.

Intent categories detected:
  - hours / time logged       → aggregate totals by project / date range
  - billable                  → billable flag filter
  - project lookup            → filter by project_code
  - task / entry list         → recent entries for a project or date range
  - general time query        → last N entries
"""
from __future__ import annotations

import logging
import os
import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

# ── intent patterns ────────────────────────────────────────────────────────────

_TTT_PATTERNS = re.compile(
    r"\b("
    r"hour[s]?|time log(?:ged)?|time entry|time entries|time tracker"
    r"|how long|duration|minutes? logged"
    r"|billable|non.billable"
    r"|project code|task type"
    r"|time.?sheet|timesheet"
    r"|logged (today|this week|this month|last week|last month|yesterday)"
    r"|what did I (work on|do|log)"
    r"|entries? for|tasks? for"
    r")\b",
    re.IGNORECASE,
)

# Separate pattern for meeting-history lookups that should pull TTT entries
# even when the user isn't asking about hours/billing.
_MEETING_HISTORY_PATTERNS = re.compile(
    r"\b(before|prior|previous|earlier|other|another)\b.{0,40}\bmeetings?\b"
    r"|\bmeetings?\b.{0,40}\b(before|prior|previous|earlier|other|another|this)\b"
    r"|\ball (my |the )?meetings?\b"
    r"|\blist (my |all of the |the )?meetings?\b"
    r"|\bhow many meetings?\b"
    r"|\bmeeting histor(y|ies)\b"
    r"|\bprevious meetings?\b"
    r"|\bearlier meetings?\b"
    r"|\bmeeting before\b"
    # "last two/three/N meetings", "recent meetings", "summarize N meetings"
    r"|\blast \w+ meetings?\b"
    r"|\brecent meetings?\b"
    r"|\b(two|three|four|five|2|3|4|5) meetings?\b"
    r"|\bsummar\w+ \w* meetings?\b"
    # date-scoped: "meetings today", "meetings this week", "what meetings did I have today"
    r"|\bmeetings?\b.{0,60}\b(today|yesterday|this week|this month|last week|last month)\b"
    r"|\b(today|yesterday|this week|this month|last week|last month)\b.{0,60}\bmeetings?\b"
    r"|\b(list|show|what).{0,40}\bmeetings?\b",
    re.IGNORECASE,
)


def is_ttt_query(question: str) -> bool:
    """Return True if the question should pull from the TTT database."""
    return bool(_TTT_PATTERNS.search(question) or _MEETING_HISTORY_PATTERNS.search(question))


# ── date helpers ───────────────────────────────────────────────────────────────

def _date_range_from_question(question: str) -> tuple[date | None, date | None]:
    """
    Extract a (start, end) date range from natural language.
    Returns (None, None) if no temporal phrase is found (caller will use last 90 days).
    """
    today = date.today()
    q = question.lower()

    if "today" in q:
        return today, today
    if "yesterday" in q:
        d = today - timedelta(days=1)
        return d, d
    if "this week" in q:
        start = today - timedelta(days=today.weekday())
        return start, today
    if "last week" in q:
        start = today - timedelta(days=today.weekday() + 7)
        end   = start + timedelta(days=6)
        return start, end
    if "this month" in q:
        return today.replace(day=1), today
    if "last month" in q:
        first_this = today.replace(day=1)
        last_prev  = first_this - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    if "this year" in q:
        return today.replace(month=1, day=1), today

    return None, None


def _extract_project(question: str) -> str | None:
    """
    Pull an explicit project name out of the question.
    Looks for patterns like 'for Honda', 'on Honda', 'with Honda',
    'Honda meeting', 'project Honda'.
    """
    m = re.search(
        r"\b(?:for|on|with|project(?:\s+code)?)\s+([A-Za-z0-9_\-]+)"
        r"|([A-Za-z0-9_\-]+)\s+meeting",
        question,
        re.IGNORECASE,
    )
    if not m:
        return None
    # group(1) = preposition match, group(2) = "X meeting" match
    val = (m.group(1) or m.group(2) or "").strip()
    # Ignore common stop words, numbers, and count words that aren't project names
    _STOP = {
        "the", "a", "an", "my", "this", "that", "last", "next",
        "previous", "prior", "earlier", "another", "other",
        "recent", "latest", "first", "second", "third",
        "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    }
    if val.lower() in _STOP or val.isdigit():
        return None
    return val


# ── query builder + runner ─────────────────────────────────────────────────────

def _get_conn():
    url = os.environ.get("TTT_DATABASE_URL", "")
    if not url:
        raise RuntimeError("TTT_DATABASE_URL is not set.")
    ssl = "sslmode=require" in url or os.environ.get("TTT_PGSSL", "true").lower() == "true"
    kwargs: dict[str, Any] = {"dsn": url}
    if ssl:
        kwargs["sslmode"] = "require"
    return psycopg2.connect(**kwargs)


_COUNT_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
                "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def _extract_count(question: str) -> int | None:
    """Return an explicit count from phrases like 'last two meetings', 'last 3 entries', etc."""
    m = re.search(r"\blast\s+(\w+)\s+\w+", question, re.IGNORECASE)
    if m:
        word = m.group(1).lower()
        if word.isdigit():
            return int(word)
        return _COUNT_WORDS.get(word)
    return None


def query_ttt(
    question: str,
    limit: int = 20,
    force_meetings: bool = False,
    user_id: str | None = None,
) -> str:
    """
    Run an appropriate SQL query against time_entries based on the question
    and return a formatted string suitable for use as LLM context.

    Args:
        question:       The user's natural-language question.
        limit:          Max rows to return.
        force_meetings: When True, always use the meeting-list query shape
                        (used when called from a temporal meeting chat query).
        user_id:        When set, restrict results to this user's entries only.

    Returns an empty string if TTT_DATABASE_URL is not configured.
    """
    ttt_url = os.environ.get("TTT_DATABASE_URL", "")
    if not ttt_url:
        return ""

    start, end = _date_range_from_question(question)
    project    = _extract_project(question)
    q_lower    = question.lower()

    # Honour explicit count in "last N meetings"
    explicit_count = _extract_count(question)
    if explicit_count:
        limit = explicit_count

    # Default range: ±365 days from today when no temporal phrase found.
    # Wide window so queries work regardless of whether entries are dated in the
    # past or future (TTT entries may be pushed with server-local dates).
    if start is None:
        start = date.today() - timedelta(days=365)
        end   = date.today() + timedelta(days=365)

    params: dict[str, Any] = {"start": start, "end": end, "limit": limit}

    # ── choose query shape ────────────────────────────────────────────────────
    if force_meetings or _MEETING_HISTORY_PATTERNS.search(question):
        # List meeting entries with titles and dates so the LLM can reason about
        # which meetings exist and which came before/after others.
        sql = """
            SELECT project_code, task_type, entry_date,
                   start_time, duration_minutes, meeting_title,
                   LEFT(description, 1000) AS description
            FROM time_entries
            WHERE task_type = 'meeting'
              AND entry_date BETWEEN %(start)s AND %(end)s
            {project_filter}
            {user_filter}
            ORDER BY entry_date DESC, start_time DESC NULLS LAST
            LIMIT %(limit)s
        """
    elif re.search(r"\b(total|sum|how many hours?|how much time|aggregate)\b", q_lower):
        # Aggregated totals by project
        sql = """
            SELECT
                project_code,
                task_type,
                SUM(duration_minutes) AS total_minutes,
                COUNT(*)              AS entries,
                MIN(entry_date)       AS from_date,
                MAX(entry_date)       AS to_date,
                BOOL_OR(billable)     AS any_billable
            FROM time_entries
            WHERE entry_date BETWEEN %(start)s AND %(end)s
            {project_filter}
            {user_filter}
            GROUP BY project_code, task_type
            ORDER BY total_minutes DESC
            LIMIT %(limit)s
        """
    elif re.search(r"\bbillable\b", q_lower):
        sql = """
            SELECT id, project_code, task_type, entry_date,
                   start_time, duration_minutes, billable, status, description
            FROM time_entries
            WHERE entry_date BETWEEN %(start)s AND %(end)s
              AND billable = TRUE
            {project_filter}
            {user_filter}
            ORDER BY entry_date DESC, start_time DESC NULLS LAST
            LIMIT %(limit)s
        """
    else:
        # Default: recent entries with description
        sql = """
            SELECT id, project_code, task_type, entry_date,
                   start_time, duration_minutes, billable, status,
                   meeting_title, description
            FROM time_entries
            WHERE entry_date BETWEEN %(start)s AND %(end)s
            {project_filter}
            {user_filter}
            ORDER BY entry_date DESC, start_time DESC NULLS LAST
            LIMIT %(limit)s
        """

    # Inject optional project and user filters
    if project:
        project_clause = "AND project_code ILIKE %(project)s"
        params["project"] = f"%{project}%"
    else:
        project_clause = ""

    if user_id:
        user_clause = "AND user_id = %(user_id)s"
        params["user_id"] = user_id
    else:
        user_clause = ""

    sql = sql.format(project_filter=project_clause, user_filter=user_clause)

    try:
        conn = _get_conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        finally:
            conn.close()
    except Exception as exc:
        log.warning("TTT query failed: %s", exc)
        return ""

    if not rows:
        return f"[Time Task Tracker] No entries found for the queried period ({start} – {end}).\n"

    # ── format rows as readable context ──────────────────────────────────────
    lines = [f"[Time Task Tracker — {len(rows)} result(s), {start} to {end}]"]
    for row in rows:
        row = dict(row)
        # Convert Decimal to float for display
        mins = float(row.get("total_minutes") or row.get("duration_minutes") or 0)
        hours = mins / 60

        if "total_minutes" in row:
            # Aggregated row
            lines.append(
                f"  Project: {row['project_code']} | Type: {row['task_type']} | "
                f"Total: {mins:.0f} min ({hours:.1f} h) | Entries: {row['entries']} | "
                f"Billable: {row.get('any_billable', False)} | "
                f"Period: {row['from_date']} – {row['to_date']}"
            )
        else:
            # Individual entry
            desc = (row.get("description") or "")[:800].replace("\n", " ")
            lines.append(
                f"  [{row['entry_date']}] {row['project_code']} / {row['task_type']} | "
                f"{mins:.0f} min | Billable: {row.get('billable', False)} | "
                f"Status: {row.get('status')} | {row.get('meeting_title') or ''}\n"
                f"    Summary: {desc}"
            )

    return "\n".join(lines) + "\n"
