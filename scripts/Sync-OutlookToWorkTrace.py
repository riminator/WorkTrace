#!/usr/bin/env python3
"""
Sync-OutlookToWorkTrace.py
──────────────────────────
Reads calendar events from macOS Calendar.app (which Outlook for Mac syncs
into automatically) and imports them into WorkTrace.

No Entra app, no OAuth, no Microsoft Graph required.

Requirements:
    pip install requests

Usage:
    python3 scripts/Sync-OutlookToWorkTrace.py
    python3 scripts/Sync-OutlookToWorkTrace.py --days-back 30   # first-run backfill
    python3 scripts/Sync-OutlookToWorkTrace.py --whatif          # dry-run, prints ICS
    python3 scripts/Sync-OutlookToWorkTrace.py --list-calendars  # show available calendars

Schedule with launchd (see docs/OutlookSync.md) or just run manually.
"""

import argparse
import io
import logging
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

# ── Logging ───────────────────────────────────────────────────────────────────

LOG_FILE = os.path.expanduser("~/Library/Logs/WorkTraceSync.log")
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── Defaults (update WorkTrace URL when cluster changes) ──────────────────────

# Update these two values when your cluster changes.
# WORKTRACE_TOKEN is the same as WORKTRACE_TOKEN in ~/.bob/settings/mcp.json
WORKTRACE_URL   = "https://knowledgebase-knowledgebase.apps.YOUR-CLUSTER.techzone.ibm.com"
WORKTRACE_TOKEN = "YOUR-WORKTRACE-JWT-TOKEN"


# ── ICS helpers ───────────────────────────────────────────────────────────────

def _ics_dt(dt: datetime) -> str:
    """Format a datetime as ICS UTC timestamp: 20250101T090000Z"""
    utc = dt.astimezone(timezone.utc)
    return utc.strftime("%Y%m%dT%H%M%SZ")


def _ics_escape(text: str) -> str:
    if not text:
        return ""
    text = text.replace("\\", "\\\\")
    text = text.replace(";", "\\;")
    text = text.replace(",", "\\,")
    text = text.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")
    return text


def _ics_fold(line: str) -> str:
    """RFC 5545 §3.1 — fold lines longer than 75 octets."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    parts = []
    pos = 0
    first = True
    while pos < len(encoded):
        limit = 75 if first else 74
        chunk = encoded[pos: pos + limit]
        # avoid splitting a multi-byte UTF-8 sequence
        while len(chunk) > 1 and (chunk[-1] & 0xC0) == 0x80:
            chunk = chunk[:-1]
        parts.append(("" if first else " ") + chunk.decode("utf-8"))
        pos += len(chunk)
        first = False
    return "\r\n".join(parts)


def build_ics(events: list[dict]) -> str:
    """
    Build an ICS string from a list of event dicts.
    Each dict: {uid, summary, start (datetime), end (datetime),
                description, organizer, location}
    """
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//WorkTrace Mac Sync//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for ev in events:
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{ev['uid']}")
        lines.append(_ics_fold(f"SUMMARY:{_ics_escape(ev['summary'])}"))
        lines.append(f"DTSTART:{_ics_dt(ev['start'])}")
        lines.append(f"DTEND:{_ics_dt(ev['end'])}")
        if ev.get("location"):
            lines.append(_ics_fold(f"LOCATION:{_ics_escape(ev['location'])}"))
        if ev.get("organizer"):
            org = _ics_escape(ev["organizer"])
            lines.append(f"ORGANIZER;CN={org}:mailto:{org}")
        if ev.get("description"):
            desc = ev["description"][:500]  # truncate to keep payload small
            lines.append(_ics_fold(f"DESCRIPTION:{_ics_escape(desc)}"))
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


# ── AppleScript / Calendar.app (macOS Sequoia compatible) ────────────────────
#
# macOS 15 Sequoia removed the ability to add CLI tools to the Calendar
# privacy list. Calendar.app itself has Full Access and exposes all events
# through AppleScript. We talk to Calendar.app via osascript — no EventKit
# TCC permission needed.

def _run_applescript(script: str) -> str:
    """Run an AppleScript string via osascript and return stdout."""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"osascript error: {result.stderr.strip()}")
    return result.stdout.strip()


def fetch_events(days_back: int, days_forward: int, calendar_filter: list[str] | None = None) -> list[dict]:
    """
    Pull events from Calendar.app via AppleScript.
    Calendar.app already has TCC Full Access — no extra permissions needed.
    """
    now      = datetime.now()
    start_dt = now - timedelta(days=days_back)
    end_dt   = now + timedelta(days=days_forward)

    # AppleScript date format: "Thursday, July 24, 2025 at 9:00:00 AM"
    # Easiest to pass as a POSIX timestamp and let AS convert
    as_start = start_dt.strftime("%-m/%-d/%Y")
    as_end   = end_dt.strftime("%-m/%-d/%Y")

    # Build calendar filter clause
    if calendar_filter:
        cal_condition = " or ".join(
            f'name of cal is "{c}"' for c in calendar_filter
        )
        cal_clause = f"if ({cal_condition}) then"
    else:
        cal_clause = "if true then"

    script = f"""
set startDate to date "{as_start}"
set endDate to date "{as_end}"
set output to ""

tell application "Calendar"
    repeat with cal in calendars
        {cal_clause}
            set evts to (every event of cal whose start date >= startDate and start date <= endDate)
            repeat with e in evts
                set t to summary of e
                set sd to start date of e
                set ed to end date of e
                set loc to ""
                try
                    set loc to location of e
                    if loc is missing value then set loc to ""
                end try
                set desc to ""
                try
                    set desc to description of e
                    if desc is missing value then set desc to ""
                end try
                set evtUid to uid of e
                -- format: uid|title|startdate|enddate|location|description
                set output to output & evtUid & "|" & t & "|" & (sd as string) & "|" & (ed as string) & "|" & loc & "|" & desc & "\\n"
            end repeat
        end if
    end repeat
end tell
return output
"""
    try:
        raw = _run_applescript(script)
    except RuntimeError as e:
        log.error("AppleScript failed: %s", e)
        log.error("Make sure Calendar.app is open and has calendar access in System Settings.")
        sys.exit(1)

    if not raw:
        return []

    events = []
    for line in raw.strip().splitlines():
        parts = line.split("|", 5)
        if len(parts) < 4:
            continue
        uid, title, start_s, end_s = parts[0], parts[1], parts[2], parts[3]
        location    = parts[4] if len(parts) > 4 else ""
        description = parts[5] if len(parts) > 5 else ""

        try:
            # AppleScript returns times in the local system timezone
            # (e.g. "July 17, 2026 at 9:00:00 AM" = 9 AM local, not 9 AM UTC).
            # We must attach the local timezone first, then convert to UTC for ICS.
            import time as _time  # noqa: PLC0415
            local_tz = datetime.now(timezone.utc).astimezone().tzinfo

            def _parse_as_date(s: str) -> datetime:
                # Remove "DayName, " prefix if present
                if ", " in s:
                    s = s.split(", ", 1)[1]
                for fmt in ("%B %d, %Y at %I:%M:%S %p", "%B %d, %Y at %H:%M:%S",
                            "%B %d, %Y"):
                    try:
                        # attach local tz, then convert to UTC
                        return datetime.strptime(s.strip(), fmt) \
                                       .replace(tzinfo=local_tz) \
                                       .astimezone(timezone.utc)
                    except ValueError:
                        continue
                raise ValueError(f"Cannot parse date: {s!r}")

            start_dt_ev = _parse_as_date(start_s)
            end_dt_ev   = _parse_as_date(end_s)
        except Exception as exc:
            log.warning("Skipping event %r — date parse failed: %s", title, exc)
            continue

        events.append({
            "uid":         uid or str(uuid.uuid4()),
            "summary":     title or "(No title)",
            "start":       start_dt_ev,
            "end":         end_dt_ev,
            "description": description[:500],
            "organizer":   "",
            "location":    location,
        })

    return events


def list_calendars() -> None:
    """Print all available calendars via AppleScript."""
    script = """
tell application "Calendar"
    set output to ""
    repeat with cal in calendars
        set output to output & name of cal & "\\n"
    end repeat
    return output
end tell
"""
    try:
        raw = _run_applescript(script)
    except RuntimeError as e:
        log.error("AppleScript failed: %s", e)
        sys.exit(1)

    print("\nAvailable calendars:")
    for name in raw.strip().splitlines():
        if name:
            print(f"  {name}")
    print()


# ── POST to WorkTrace ─────────────────────────────────────────────────────────

def post_ics(ics_content: str, url: str, token: str) -> dict:
    try:
        import requests  # noqa: PLC0415
    except ImportError:
        log.error("requests is not installed. Fix: pip install requests")
        sys.exit(1)

    endpoint = url.rstrip("/") + "/api/ttt/import/ics"
    log.info("POSTing to %s", endpoint)

    resp = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("outlook.ics", io.BytesIO(ics_content.encode("utf-8")), "text/calendar")},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync macOS Calendar (Outlook) events to WorkTrace."
    )
    parser.add_argument("--days-back",        type=int,   default=7,
                        help="Days back to pull (default: 7). Use 30 for first-run backfill.")
    parser.add_argument("--days-forward",     type=int,   default=1,
                        help="Days forward to include (default: 1).")
    parser.add_argument("--worktrace-url",    type=str,   default=WORKTRACE_URL,
                        help="WorkTrace base URL.")
    parser.add_argument("--token",            type=str,   default=WORKTRACE_TOKEN,
                        help="WorkTrace JWT token.")
    parser.add_argument("--calendar-filter",  type=str,   default=None,
                        help="Comma-separated calendar names to include (default: all). "
                             "Use --list-calendars to see names.")
    parser.add_argument("--list-calendars",   action="store_true",
                        help="Print all available calendars and exit.")
    parser.add_argument("--whatif",           action="store_true",
                        help="Dry-run: print ICS to stdout, do not POST to WorkTrace.")
    args = parser.parse_args()

    if args.list_calendars:
        list_calendars()
        return

    log.info(
        "Starting WorkTrace calendar sync (days_back=%d, days_forward=%d)",
        args.days_back, args.days_forward,
    )

    cal_filter = [c.strip() for c in args.calendar_filter.split(",")] if args.calendar_filter else None
    events = fetch_events(args.days_back, args.days_forward, cal_filter)
    log.info("Fetched %d events from Calendar.app", len(events))

    if not events:
        log.warning("No events found — nothing to import.")
        return

    ics = build_ics(events)

    if args.whatif:
        print("\n--- ICS PREVIEW ---\n")
        print(ics)
        print("\n--- END ICS ---\n")
        log.info("WhatIf mode — skipped POST to WorkTrace.")
        return

    result = post_ics(ics, args.worktrace_url, args.token)
    log.info(
        "SUCCESS — imported %d entries, %d failed.",
        result.get("count", 0),
        result.get("failed", 0),
    )


if __name__ == "__main__":
    main()
