"""
ttt_api.py — Task Time Tracker API routes for the unified KnowledgeBase app.

All routes are mounted under /ttt and require a valid Supabase JWT.
Every query is scoped to the authenticated user_id so users only see
their own time entries.

Routes:
  GET    /ttt/entries              list entries with optional filters
  GET    /ttt/entries/{id}         get a single entry
  POST   /ttt/entries              create a new entry
  PUT    /ttt/entries/{id}         update an entry
  DELETE /ttt/entries/{id}         delete an entry
  POST   /ttt/entries/bulk-delete  delete multiple entries by ID list
  GET    /ttt/summary              aggregate statistics
  GET    /ttt/export/csv           download entries as CSV
  POST   /ttt/import/csv          import from CSV upload
  POST   /ttt/import/ics          import from ICS calendar upload
  GET    /ttt/projects             list distinct project codes for this user
  POST   /ttt/classify             stateless meeting title classifier
"""
from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import date, datetime
from typing import Annotated, Any

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from kb.auth import get_current_user
from kb.config import TTT_DATABASE_URL

router = APIRouter(prefix="/ttt", tags=["ttt"])

# ── DB connection ─────────────────────────────────────────────────────────────

def _get_conn():
    if not TTT_DATABASE_URL:
        raise HTTPException(status_code=503, detail="TTT_DATABASE_URL is not configured.")
    return psycopg2.connect(TTT_DATABASE_URL, sslmode="require")


def _row_to_dict(row: dict) -> dict:
    """Normalise a DB row to the camelCase shape the frontend expects."""
    entry_date = row.get("entry_date")
    if isinstance(entry_date, date):
        entry_date = entry_date.isoformat()

    def _iso(val):
        if val is None:
            return None
        if isinstance(val, datetime):
            return val.isoformat()
        return str(val)

    return {
        "id":              row["id"],
        "projectCode":     row.get("project_code") or "GENERAL",
        "taskType":        row.get("task_type") or "meeting",
        "durationMinutes": float(row.get("duration_minutes") or 0),
        "date":            entry_date,
        "startTime":       _iso(row.get("start_time")),
        "endTime":         _iso(row.get("end_time")),
        "description":     row.get("description"),
        "meetingTitle":    row.get("meeting_title"),
        "billable":        bool(row.get("billable")),
        "confidence":      float(row.get("confidence") or 0),
        "status":          row.get("status") or "logged",
        "organizer":       row.get("organizer"),
        "attendees":       row.get("attendees"),
        "createdAt":       None,
        "updatedAt":       None,
    }


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class EntryCreate(BaseModel):
    date: str
    durationMinutes: float
    meetingTitle: str | None = None
    projectCode: str = "GENERAL"
    taskType: str = "meeting"
    billable: bool = False
    description: str | None = None
    startTime: str | None = None
    endTime: str | None = None
    organizer: str | None = None
    attendees: str | None = None
    confidence: float = 0.0
    status: str = "logged"


class EntryUpdate(BaseModel):
    date: str | None = None
    durationMinutes: float | None = None
    meetingTitle: str | None = None
    projectCode: str | None = None
    taskType: str | None = None
    billable: bool | None = None
    description: str | None = None
    startTime: str | None = None
    endTime: str | None = None
    organizer: str | None = None
    attendees: str | None = None
    status: str | None = None


class BulkDeleteRequest(BaseModel):
    ids: list[str]


class ClassifyRequest(BaseModel):
    title: str
    organizer: str | None = None
    attendees: list[str] = []


# ── Classification (ported from classification.js) ────────────────────────────

_TITLE_PATTERNS = [
    (re.compile(r"Project\s+(\w+)", re.I),      None,    "project-work",  0.9),
    (re.compile(r"Sprint\s+(Planning|Review|Retro)", re.I), "SCRUM", "ceremony", 0.85),
    (re.compile(r"Daily\s+Standup|Daily\s+Scrum", re.I),    "SCRUM", "standup",  0.85),
    (re.compile(r"1:1|One\s+on\s+One",           re.I),     "ADMIN", "one-on-one", 0.85),
]
_BILLABLE_PATTERNS    = ["client", "customer", "consulting"]
_NONBILLABLE_PATTERNS = ["internal", "team", "admin", "training"]


def _classify(title: str, organizer: str | None = None) -> dict:
    project_code = "GENERAL"
    task_type    = "meeting"
    confidence   = 0.2

    for pattern, code, ttype, conf in _TITLE_PATTERNS:
        m = pattern.search(title)
        if m:
            project_code = (m.group(1).upper() if code is None else code)
            task_type    = ttype
            confidence   = conf
            break

    t_lower = title.lower()
    billable = any(p in t_lower for p in _BILLABLE_PATTERNS)
    if not billable:
        billable = not any(p in t_lower for p in _NONBILLABLE_PATTERNS)

    return {
        "projectCode": project_code,
        "taskType":    task_type,
        "billable":    billable,
        "confidence":  confidence,
    }


# ── CSV / ICS helpers ─────────────────────────────────────────────────────────

def _parse_date(val: str) -> str:
    val = val.strip()
    # M/D/YY or M/D/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$", val)
    if m:
        month, day, year = m.group(1), m.group(2), m.group(3)
        if len(year) == 2:
            year = "20" + year
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    # Already ISO or parseable
    try:
        return datetime.fromisoformat(val.split("T")[0]).date().isoformat()
    except Exception:
        return date.today().isoformat()


def _parse_time_24(val: str) -> str | None:
    if not val:
        return None
    m = re.match(r"(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$", val.strip(), re.I)
    if not m:
        return None
    h, mins, meridiem = int(m.group(1)), m.group(2), (m.group(3) or "").upper()
    if meridiem == "PM" and h != 12:
        h += 12
    if meridiem == "AM" and h == 12:
        h = 0
    return f"{h:02d}:{mins}:00"


def _parse_csv_bytes(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig").replace("\r\n", "\n")
    reader = csv.DictReader(io.StringIO(text))
    entries = []
    for row in reader:
        title = (row.get("Meeting/Project Title") or row.get("Meeting / Project Title")
                 or row.get("title") or row.get("meetingTitle") or "").strip()
        duration_hrs = row.get("Duration (hrs)") or row.get("durationMinutes") or "1"
        try:
            duration_min = float(duration_hrs) * 60
        except ValueError:
            duration_min = 60.0

        raw_date  = row.get("Date") or row.get("date") or ""
        start_raw = row.get("Start Time") or row.get("startTime") or ""
        end_raw   = row.get("End Time")   or row.get("endTime")   or ""
        parsed_date = _parse_date(raw_date) if raw_date else date.today().isoformat()
        start_24  = _parse_time_24(start_raw)
        end_24    = _parse_time_24(end_raw)

        if not title:
            continue

        cl = _classify(title)
        entries.append({
            "date":            parsed_date,
            "meetingTitle":    title,
            "projectCode":     row.get("Project / Client Name") or row.get("Project/Client Name") or cl["projectCode"],
            "taskType":        cl["taskType"],
            "durationMinutes": duration_min,
            "startTime":       f"{parsed_date}T{start_24}Z" if start_24 else None,
            "endTime":         f"{parsed_date}T{end_24}Z"   if end_24   else None,
            "description":     row.get("Notes") or row.get("description") or "",
            "attendees":       row.get("Employee(s) Attended Name(s)") or row.get("attendees") or "",
            "billable":        cl["billable"],
            "confidence":      cl["confidence"],
            "status":          "logged",
        })
    return entries


def _parse_ics_bytes(content: bytes) -> list[dict]:
    text = content.decode("utf-8", errors="replace")
    entries = []
    for block in text.split("BEGIN:VEVENT")[1:]:
        summary = re.search(r"SUMMARY:(.*)", block)
        dtstart = re.search(r"DTSTART[^:]*:(.*)", block)
        dtend   = re.search(r"DTEND[^:]*:(.*)", block)
        desc    = re.search(r"DESCRIPTION:(.*)", block)
        org     = re.search(r"ORGANIZER[^:]*:mailto:(.*)", block)

        if not summary or not dtstart:
            continue

        title    = summary.group(1).strip()
        start_s  = dtstart.group(1).strip()
        end_s    = dtend.group(1).strip() if dtend else start_s

        def _ics_dt(s: str) -> datetime | None:
            s = re.sub(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})", r"\1-\2-\3T\4:\5:\6", s)
            try:
                return datetime.fromisoformat(s[:19])
            except Exception:
                return None

        start_dt = _ics_dt(start_s)
        end_dt   = _ics_dt(end_s)
        if not start_dt:
            continue

        duration_min = ((end_dt - start_dt).total_seconds() / 60) if end_dt else 60.0
        cl = _classify(title, org.group(1).strip() if org else None)

        entries.append({
            "date":            start_dt.date().isoformat(),
            "meetingTitle":    title,
            "projectCode":     cl["projectCode"],
            "taskType":        cl["taskType"],
            "durationMinutes": duration_min,
            "startTime":       start_dt.isoformat(),
            "endTime":         end_dt.isoformat() if end_dt else None,
            "description":     desc.group(1).strip() if desc else "",
            "organizer":       org.group(1).strip() if org else None,
            "billable":        cl["billable"],
            "confidence":      cl["confidence"],
            "status":          "logged",
        })
    return entries


def _insert_entries(entries: list[dict], user_id: str, conn) -> tuple[int, int]:
    """Bulk-insert parsed entries. Returns (inserted, failed)."""
    inserted = failed = 0
    with conn.cursor() as cur:
        for e in entries:
            try:
                cur.execute("""
                    INSERT INTO time_entries
                        (id, user_id, project_code, task_type, duration_minutes,
                         entry_date, start_time, end_time, description, meeting_title,
                         billable, confidence, status, organizer, attendees)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO NOTHING
                """, (
                    str(uuid.uuid4()),
                    user_id,
                    e.get("projectCode", "GENERAL"),
                    e.get("taskType", "meeting"),
                    e.get("durationMinutes", 60),
                    e.get("date"),
                    e.get("startTime"),
                    e.get("endTime"),
                    e.get("description"),
                    e.get("meetingTitle"),
                    bool(e.get("billable", False)),
                    float(e.get("confidence", 0)),
                    e.get("status", "logged"),
                    e.get("organizer"),
                    e.get("attendees") if isinstance(e.get("attendees"), str)
                        else ", ".join(e.get("attendees") or []),
                ))
                inserted += 1
            except Exception:
                conn.rollback()
                failed += 1
    conn.commit()
    return inserted, failed


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/entries")
def list_entries(
    start_date:   str | None = Query(None),
    end_date:     str | None = Query(None),
    project_code: str | None = Query(None),
    user_id: str = Depends(get_current_user),
) -> list[dict]:
    conn = _get_conn()
    try:
        conditions = ["user_id = %s"]
        params: list[Any] = [user_id]
        if start_date:
            conditions.append("entry_date >= %s"); params.append(start_date)
        if end_date:
            conditions.append("entry_date <= %s"); params.append(end_date)
        if project_code:
            conditions.append("project_code = %s"); params.append(project_code)
        where = " AND ".join(conditions)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SELECT * FROM time_entries WHERE {where} ORDER BY entry_date DESC", params)
            return [_row_to_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@router.post("/entries/bulk-delete")
def bulk_delete_entries(
    req: BulkDeleteRequest,
    user_id: str = Depends(get_current_user),
) -> dict:
    if not req.ids:
        raise HTTPException(status_code=400, detail="No IDs provided.")
    conn = _get_conn()
    try:
        deleted = 0
        with conn.cursor() as cur:
            for eid in req.ids:
                cur.execute(
                    "DELETE FROM time_entries WHERE id = %s AND user_id = %s",
                    (eid, user_id),
                )
                deleted += cur.rowcount
        conn.commit()
        return {"deletedCount": deleted, "totalRequested": len(req.ids)}
    finally:
        conn.close()


@router.get("/entries/{entry_id}")
def get_entry(
    entry_id: str,
    user_id: str = Depends(get_current_user),
) -> dict:
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM time_entries WHERE id = %s AND user_id = %s", (entry_id, user_id))
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found.")
        return _row_to_dict(row)
    finally:
        conn.close()


@router.post("/entries", status_code=201)
def create_entry(
    entry: EntryCreate,
    user_id: str = Depends(get_current_user),
) -> dict:
    conn = _get_conn()
    try:
        eid = str(uuid.uuid4())
        attendees = entry.attendees if isinstance(entry.attendees, str) else (", ".join(entry.attendees) if entry.attendees else None)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO time_entries
                    (id, user_id, project_code, task_type, duration_minutes, entry_date,
                     start_time, end_time, description, meeting_title, billable,
                     confidence, status, organizer, attendees)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (
                eid, user_id, entry.projectCode, entry.taskType,
                entry.durationMinutes, entry.date, entry.startTime, entry.endTime,
                entry.description, entry.meetingTitle, entry.billable,
                entry.confidence, entry.status, entry.organizer, attendees,
            ))
            row = cur.fetchone()
        conn.commit()
        return _row_to_dict(row)
    finally:
        conn.close()


@router.put("/entries/{entry_id}")
def update_entry(
    entry_id: str,
    updates: EntryUpdate,
    user_id: str = Depends(get_current_user),
) -> dict:
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM time_entries WHERE id = %s AND user_id = %s", (entry_id, user_id))
            existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Entry not found.")

        data = updates.model_dump(exclude_none=True)
        if not data:
            return _row_to_dict(existing)

        # Map camelCase → snake_case columns
        col_map = {
            "date": "entry_date", "durationMinutes": "duration_minutes",
            "meetingTitle": "meeting_title", "projectCode": "project_code",
            "taskType": "task_type", "startTime": "start_time",
            "endTime": "end_time",
        }
        set_parts, params = [], []
        for key, val in data.items():
            col = col_map.get(key, key)
            set_parts.append(f"{col} = %s")
            params.append(val)
        set_parts.append("updated_at = NOW()")
        params += [entry_id, user_id]

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"UPDATE time_entries SET {', '.join(set_parts)} WHERE id = %s AND user_id = %s RETURNING *",
                params,
            )
            row = cur.fetchone()
        conn.commit()
        return _row_to_dict(row)
    finally:
        conn.close()


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(
    entry_id: str,
    user_id: str = Depends(get_current_user),
) -> None:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM time_entries WHERE id = %s AND user_id = %s", (entry_id, user_id))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Entry not found.")
        conn.commit()
    finally:
        conn.close()


@router.get("/summary")
def get_summary(
    start_date: str | None = Query(None),
    end_date:   str | None = Query(None),
    user_id: str = Depends(get_current_user),
) -> dict:
    entries = list_entries(start_date=start_date, end_date=end_date, user_id=user_id)

    total_min    = sum(e["durationMinutes"] for e in entries)
    billable_min = sum(e["durationMinutes"] for e in entries if e["billable"])

    by_project: dict[str, dict] = {}
    by_day:     dict[str, dict] = {}
    by_type:    dict[str, dict] = {}

    for e in entries:
        p = e["projectCode"] or "GENERAL"
        by_project.setdefault(p, {"count": 0, "minutes": 0})
        by_project[p]["count"]   += 1
        by_project[p]["minutes"] += e["durationMinutes"]

        d = (e["date"] or "")[:10]
        by_day.setdefault(d, {"count": 0, "minutes": 0})
        by_day[d]["count"]   += 1
        by_day[d]["minutes"] += e["durationMinutes"]

        t = e["taskType"] or "other"
        by_type.setdefault(t, {"count": 0, "minutes": 0})
        by_type[t]["count"]   += 1
        by_type[t]["minutes"] += e["durationMinutes"]

    return {
        "totalEntries":    len(entries),
        "totalHours":      total_min / 60,
        "billableHours":   billable_min / 60,
        "nonBillableHours": (total_min - billable_min) / 60,
        "projectCount":    len(by_project),
        "byProject": sorted(
            [{"project": p, "hours": v["minutes"] / 60, "count": v["count"],
              "percentage": (v["minutes"] / total_min * 100) if total_min else 0}
             for p, v in by_project.items()],
            key=lambda x: x["hours"], reverse=True,
        ),
        "byDay": sorted(
            [{"date": d, "hours": v["minutes"] / 60, "count": v["count"]}
             for d, v in by_day.items()],
            key=lambda x: x["date"],
        ),
        "byType": sorted(
            [{"type": t, "hours": v["minutes"] / 60, "count": v["count"],
              "percentage": (v["minutes"] / total_min * 100) if total_min else 0}
             for t, v in by_type.items()],
            key=lambda x: x["hours"], reverse=True,
        ),
    }


@router.get("/export/csv")
def export_csv(
    start_date: str | None = Query(None),
    end_date:   str | None = Query(None),
    user_id: str = Depends(get_current_user),
):
    entries = list_entries(start_date=start_date, end_date=end_date, user_id=user_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Date", "Project Code", "Task Type", "Duration (minutes)",
                     "Duration (hours)", "Billable", "Meeting Title", "Description",
                     "Organizer", "Attendees", "Status"])
    for e in entries:
        writer.writerow([
            e["id"], e["date"], e["projectCode"], e["taskType"],
            e["durationMinutes"], f"{e['durationMinutes']/60:.2f}",
            "Yes" if e["billable"] else "No",
            e.get("meetingTitle") or "",
            e.get("description") or "",
            e.get("organizer") or "",
            e.get("attendees") or "",
            e.get("status") or "",
        ])
    output.seek(0)
    filename = f"time-entries-{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter([output.read()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import/csv")
async def import_csv(
    file: Annotated[UploadFile, File()],
    user_id: str = Depends(get_current_user),
) -> dict:
    content = await file.read()
    try:
        entries = _parse_csv_bytes(content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {exc}")
    if not entries:
        raise HTTPException(status_code=400, detail="No valid rows found in CSV.")
    conn = _get_conn()
    try:
        inserted, failed = _insert_entries(entries, user_id, conn)
    finally:
        conn.close()
    return {"success": True, "count": inserted, "failed": failed}


@router.post("/import/ics")
async def import_ics(
    file: Annotated[UploadFile, File()],
    user_id: str = Depends(get_current_user),
) -> dict:
    content = await file.read()
    try:
        entries = _parse_ics_bytes(content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"ICS parse error: {exc}")
    if not entries:
        raise HTTPException(status_code=400, detail="No valid events found in ICS file.")
    conn = _get_conn()
    try:
        inserted, failed = _insert_entries(entries, user_id, conn)
    finally:
        conn.close()
    return {"success": True, "count": inserted, "failed": failed}


@router.get("/projects")
def list_projects(user_id: str = Depends(get_current_user)) -> list[str]:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT project_code FROM time_entries WHERE user_id = %s ORDER BY project_code",
                (user_id,),
            )
            return [r[0] for r in cur.fetchall() if r[0]]
    finally:
        conn.close()


@router.post("/classify")
def classify(req: ClassifyRequest) -> dict:
    return _classify(req.title, req.organizer)
