import { useState, useEffect, useCallback, useRef } from "react";
import { getEntries, importICS } from "../tttApi";
import { useDropzone } from "react-dropzone";
import { useTheme } from "../context/ThemeContext";

// ── helpers ───────────────────────────────────────────────────────────────────

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + 1); // start Monday
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function fmtTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// taskColor() is now a hook-free helper — components call useTheme().getTaskColor(type)
// This stub stays for the popover which is rendered outside component scope
function taskColorFallback(type) {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const map = dark ? {
    meeting: { bg: "#444791", border: "#6264a7", text: "#fff" },
    other:   { bg: "#3d5266", border: "#6b8099", text: "#fff" },
  } : {
    meeting: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
    other:   { bg: "#f1f5f9", border: "#64748b", text: "#334155" },
  };
  return map[type] || map.other;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// grid constants
const HOUR_HEIGHT = 56;   // px per hour
const START_HOUR  = 7;    // 7 AM
const END_HOUR    = 20;   // 8 PM
const TOTAL_HOURS = END_HOUR - START_HOUR;
const GRID_HEIGHT = HOUR_HEIGHT * TOTAL_HOURS;
const TIME_COL_W  = 52;   // px for the time label column

// ── time helpers ──────────────────────────────────────────────────────────────

function minutesSinceMidnight(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  return d.getHours() * 60 + d.getMinutes();
}

function topPct(startMins) {
  const clipped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, startMins));
  return ((clipped - START_HOUR * 60) / (TOTAL_HOURS * 60)) * GRID_HEIGHT;
}

function heightPx(durationMins) {
  const h = Math.max(20, (durationMins / 60) * HOUR_HEIGHT);
  return h;
}

// ── Event block (positioned absolutely in time grid) ─────────────────────────

function EventBlock({ entry, onSelect, colCount = 1, colIndex = 0, getColor }) {
  const c = getColor(entry.taskType);
  const startMins = minutesSinceMidnight(entry.startTime);
  if (startMins === null) return null;

  const top  = topPct(startMins);
  const h    = heightPx(entry.durationMinutes || 30);
  const gap  = 2;
  const w    = `calc((100% - ${gap * (colCount - 1)}px) / ${colCount})`;
  const left = `calc(${colIndex} * (100% + ${gap}px) / ${colCount})`;
  const short = h < 36;

  return (
    <div
      onClick={() => onSelect(entry)}
      title={entry.meetingTitle}
      style={{
        position: "absolute",
        top,
        height: h,
        width: w,
        left,
        background: c.bg,
        borderLeft: `3px solid ${c.border}`,
        borderRadius: 3,
        padding: short ? "1px 5px" : "3px 6px",
        cursor: "pointer",
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        transition: "filter 0.1s",
      }}
      onMouseEnter={ev => ev.currentTarget.style.filter = "brightness(1.15)"}
      onMouseLeave={ev => ev.currentTarget.style.filter = ""}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: c.text, lineHeight: 1.3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {entry.meetingTitle}
      </div>
      {!short && (
        <div style={{ fontSize: 10, color: c.text, opacity: 0.85, lineHeight: 1.3, marginTop: 1 }}>
          {fmtTime(entry.startTime)}{entry.endTime ? ` – ${fmtTime(entry.endTime)}` : ""}
        </div>
      )}
    </div>
  );
}

// ── Layout overlapping events into columns ────────────────────────────────────

function layoutEvents(entries) {
  const sorted = [...entries].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  const columns = []; // array of arrays of entries
  const result = [];

  for (const entry of sorted) {
    const startMins = minutesSinceMidnight(entry.startTime) ?? 0;
    const endMins   = startMins + (entry.durationMinutes || 30);

    // find a column where the last event ends before this one starts
    let placed = false;
    for (let ci = 0; ci < columns.length; ci++) {
      const lastEntry = columns[ci][columns[ci].length - 1];
      const lastEnd = (minutesSinceMidnight(lastEntry.startTime) ?? 0) + (lastEntry.durationMinutes || 30);
      if (lastEnd <= startMins) {
        columns[ci].push(entry);
        result.push({ entry, colIndex: ci });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([entry]);
      result.push({ entry, colIndex: columns.length - 1 });
    }
  }

  return result.map(r => ({ ...r, colCount: columns.length }));
}

// ── Day column (time-grid) ────────────────────────────────────────────────────

function DayColumn({ date, entries, today, onSelect, getColor }) {
  const iso     = isoDate(date);
  const isToday = iso === isoDate(today);
  const dayEntries = entries.filter(e => e.date === iso && e.startTime);
  const laid = layoutEvents(dayEntries);

  // current time indicator
  const now        = new Date();
  const nowMins    = now.getHours() * 60 + now.getMinutes();
  const showNowBar = isToday && nowMins >= START_HOUR * 60 && nowMins < END_HOUR * 60;
  const nowTop     = topPct(nowMins);

  return (
    <div style={{ flex: 1, minWidth: 0, borderRight: "1px solid var(--cal-border)", position: "relative" }}>
      {/* hour lines */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div key={i} style={{
          position: "absolute", top: i * HOUR_HEIGHT, left: 0, right: 0,
          borderTop: "1px solid var(--cal-border)", pointerEvents: "none",
        }} />
      ))}

      {/* half-hour lines */}
      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
        <div key={`h${i}`} style={{
          position: "absolute", top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2, left: 0, right: 0,
          borderTop: "1px dashed var(--cal-border-sub)", pointerEvents: "none",
        }} />
      ))}

      {/* now bar */}
      {showNowBar && (
        <div style={{
          position: "absolute", top: nowTop, left: 0, right: 0,
          borderTop: "2px solid var(--accent)", zIndex: 3, pointerEvents: "none",
        }}>
          <div style={{
            position: "absolute", left: -5, top: -5,
            width: 9, height: 9, borderRadius: "50%", background: "var(--accent)",
          }} />
        </div>
      )}

      {/* events */}
      {laid.map(({ entry, colIndex, colCount }) => (
        <EventBlock key={entry.id} entry={entry} onSelect={onSelect} colIndex={colIndex} colCount={colCount} getColor={getColor} />
      ))}
    </div>
  );
}

// ── Event detail popover ──────────────────────────────────────────────────────

function EventPopover({ entry, onClose, getColor }) {
  const c = getColor(entry.taskType);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg)", borderRadius: 8, padding: 20, maxWidth: 380, width: "90%", borderTop: `3px solid ${c.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.35)", color: "var(--text)", border: "1px solid var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.4, flex: 1, marginRight: 8 }}>{entry.meetingTitle}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--muted)", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 13, color: "var(--text-2)" }}>
          <PR label="📅 Date"     value={new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} />
          <PR label="🕐 Time"     value={entry.startTime ? `${fmtTime(entry.startTime)} – ${fmtTime(entry.endTime)}` : "—"} />
          <PR label="⏱ Duration" value={fmtDuration(entry.durationMinutes)} />
          <PR label="📁 Project"  value={entry.projectCode} />
          <PR label="🏷 Type"     value={<span style={{ background: c.bg, color: c.text, padding: "1px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{entry.taskType}</span>} />
          {entry.organizer  && <PR label="👤 Organizer" value={entry.organizer} />}
          {entry.attendees  && <PR label="👥 Attendees" value={entry.attendees} />}
          {entry.description && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 600, color: "#fff", marginBottom: 4, fontSize: 12 }}>Notes</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, background: "#2a2a2a", padding: 8, borderRadius: 5, maxHeight: 100, overflow: "auto" }}>
                {entry.description}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PR({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ width: 90, flexShrink: 0, color: "#888" }}>{label}</span>
      <span style={{ color: "#ddd" }}>{value}</span>
    </div>
  );
}

// ── ICS import dropzone ───────────────────────────────────────────────────────

function IcsDropzone({ token, onImported }) {
  const [status, setStatus] = useState("idle");
  const [msg, setMsg]       = useState("");

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    accept: { "text/calendar": [".ics"] },
    onDrop: async ([file]) => {
      if (!file) return;
      setStatus("loading"); setMsg("");
      try {
        const res = await importICS(file, token);
        setStatus("done");
        setMsg(`✅ Imported ${res.count} event${res.count !== 1 ? "s" : ""}${res.failed ? ` (${res.failed} failed)` : ""}`);
        onImported();
      } catch (e) {
        setStatus("error");
        setMsg(`❌ ${e.message}`);
      }
    },
  });

  return (
    <div>
      <div
        {...getRootProps()}
        style={{
          border: `2px dashed ${isDragActive ? "#6264a7" : "#3d3d3d"}`,
          borderRadius: 6,
          padding: "10px 14px",
          textAlign: "center",
          cursor: "pointer",
          fontSize: 12,
          color: "#888",
          background: isDragActive ? "#1e1e35" : "#1a1a1a",
          transition: "all 0.15s",
        }}
      >
        <input {...getInputProps()} />
        {status === "loading" ? "Importing…" : isDragActive ? "Drop here…" : "Drop .ics or click to import"}
      </div>
      {msg && (
        <p style={{ fontSize: 12, marginTop: 6, color: status === "done" ? "#4caf7d" : "#e05c5c", fontWeight: 600 }}>
          {msg}
        </p>
      )}
    </div>
  );
}

// ── Main CalendarView ─────────────────────────────────────────────────────────

export default function CalendarView({ token }) {
  const today     = new Date();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState(null);
  const scrollRef = useRef(null);
  const { getTaskColor } = useTheme();

  const weekEnd = addDays(weekStart, 6);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEntries({ startDate: isoDate(weekStart), endDate: isoDate(weekEnd) }, token);
      setEntries(data.filter(e => e.startTime));
    } catch (_) {}
    finally { setLoading(false); }
  }, [weekStart, token]);

  useEffect(() => { load(); }, [load]);

  // scroll to 8 AM on first render
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (8 - START_HOUR) * HOUR_HEIGHT;
    }
  }, []);

  const days = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)); // Mon–Fri

  const totalMins  = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
  const totalHours = (totalMins / 60).toFixed(1);

  const rangeLabel = (() => {
    const s = weekStart, e = addDays(weekStart, 4);
    const sm = MONTH_NAMES[s.getMonth()].slice(0,3);
    const em = MONTH_NAMES[e.getMonth()].slice(0,3);
    return s.getMonth() === e.getMonth()
      ? `${sm} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`
      : `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${e.getFullYear()}`;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", minHeight: 500, background: "var(--cal-surface)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--cal-border)" }}>

      {/* ── toolbar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--cal-bg)", borderBottom: "1px solid var(--cal-border)", flexShrink: 0, flexWrap: "wrap" }}>
        <button
          onClick={() => setWeekStart(startOfWeek(today))}
          style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, background: "var(--surface-2)", border: "1px solid var(--cal-border)", borderRadius: 4, color: "var(--text)", cursor: "pointer" }}
        >
          Today
        </button>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            onClick={() => setWeekStart(w => addDays(w, -7))}
            style={{ padding: "4px 9px", background: "var(--surface-2)", border: "1px solid var(--cal-border)", borderRadius: "4px 0 0 4px", color: "var(--text-2)", cursor: "pointer", fontSize: 14 }}
          >‹</button>
          <button
            onClick={() => setWeekStart(w => addDays(w, 7))}
            style={{ padding: "4px 9px", background: "var(--surface-2)", border: "1px solid var(--cal-border)", borderLeft: "none", borderRadius: "0 4px 4px 0", color: "var(--text-2)", cursor: "pointer", fontSize: 14 }}
          >›</button>
        </div>
        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{rangeLabel}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 2 }}>Work week</span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          {loading && <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</span>}
          {!loading && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{entries.length}</span> events ·{" "}
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{totalHours}h</span>
            </span>
          )}
          {/* ICS import inline */}
          <div style={{ width: 220 }}>
            <IcsDropzone token={token} onImported={load} />
          </div>
        </div>
      </div>

      {/* ── day headers ── */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--cal-border)", background: "var(--cal-bg)", flexShrink: 0 }}>
        {/* time gutter spacer */}
        <div style={{ width: TIME_COL_W, flexShrink: 0 }} />
        {days.map(d => {
          const iso     = isoDate(d);
          const isToday = iso === isoDate(today);
          return (
            <div key={iso} style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderLeft: "1px solid var(--cal-border)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {DAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1]}
              </div>
              <div style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 30, height: 30, borderRadius: "50%", marginTop: 2,
                background: isToday ? "#6264a7" : "transparent",
                fontSize: 16, fontWeight: 700,
                color: isToday ? "#fff" : "var(--text)",
              }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── time grid (scrollable) ── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", display: "flex" }}>

        {/* time labels */}
        <div style={{ width: TIME_COL_W, flexShrink: 0, position: "relative", height: GRID_HEIGHT }}>
          {Array.from({ length: TOTAL_HOURS }, (_, i) => {
            const hour = START_HOUR + i;
            const label = hour === 12 ? "12 PM" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
            return (
              <div key={i} style={{
                position: "absolute", top: i * HOUR_HEIGHT - 7,
                right: 8, fontSize: 10, color: "var(--muted)", userSelect: "none", whiteSpace: "nowrap",
              }}>
                {i > 0 ? label : ""}
              </div>
            );
          })}
        </div>

        {/* day columns */}
        <div style={{ flex: 1, display: "flex", position: "relative", height: GRID_HEIGHT }}>
          {days.map(d => (
            <DayColumn key={isoDate(d)} date={d} entries={entries} today={today} onSelect={setSelected} getColor={getTaskColor} />
          ))}
        </div>
      </div>

      {/* popover */}
      {selected && <EventPopover entry={selected} onClose={() => setSelected(null)} getColor={getTaskColor} />}
    </div>
  );
}


// ── SyncScriptDownload (unchanged — re-exported from original) ────────────────

const WORKTRACE_URL = window.location.origin

function makeMacScript(syncToken) {
  return `#!/usr/bin/env python3
"""
Sync-OutlookToWorkTrace.py  —  auto-generated by WorkTrace
Reads events from macOS Calendar.app and imports them into WorkTrace.

Requirements:  pip install requests
Run once:      python3 ~/Downloads/Sync-OutlookToWorkTrace.py
Schedule:      see WorkTrace → How to Use → Calendar Auto-Sync
"""
import argparse, io, logging, os, subprocess, sys, uuid
from datetime import datetime, timedelta, timezone

LOG_FILE = os.path.expanduser("~/Library/Logs/WorkTraceSync.log")
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
log = logging.getLogger(__name__)

WORKTRACE_URL   = "${WORKTRACE_URL}"
WORKTRACE_TOKEN = "${syncToken}"

def _run_applescript(script):
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def fetch_events(days_back=7, days_forward=1):
    now = datetime.now()
    as_start = (now - timedelta(days=days_back)).strftime("%-m/%-d/%Y")
    as_end   = (now + timedelta(days=days_forward)).strftime("%-m/%-d/%Y")
    script = f"""
set startDate to date "{as_start}"
set endDate to date "{as_end}"
set output to ""
tell application "Calendar"
    repeat with cal in calendars
        if name of cal is "Calendar" then
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
                set evtUid to uid of e
                set output to output & evtUid & "|" & t & "|" & (sd as string) & "|" & (ed as string) & "|" & loc & "\\n"
            end repeat
        end if
    end repeat
end tell
return output
"""
    raw = _run_applescript(script)
    if not raw:
        return []
    events = []
    local_tz = datetime.now(timezone.utc).astimezone().tzinfo
    for line in raw.strip().splitlines():
        parts = line.split("|", 4)
        if len(parts) < 4:
            continue
        uid, title, start_s, end_s = parts[0], parts[1], parts[2], parts[3]
        def parse(s):
            if ", " in s:
                s = s.split(", ", 1)[1]
            for fmt in ("%B %d, %Y at %I:%M:%S %p", "%B %d, %Y at %H:%M:%S", "%B %d, %Y"):
                try:
                    return datetime.strptime(s.strip(), fmt).replace(tzinfo=local_tz).astimezone(timezone.utc)
                except ValueError:
                    continue
            raise ValueError(s)
        try:
            s_dt = parse(start_s)
            e_dt = parse(end_s)
        except Exception as exc:
            log.warning("Skip %r: %s", title, exc)
            continue
        def ics_dt(dt):
            return dt.strftime("%Y%m%dT%H%M%SZ")
        events.append((uid or str(uuid.uuid4()), title, s_dt, e_dt))
    return events

def build_ics(events):
    lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//WorkTrace//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH"]
    for uid, title, s, e in events:
        lines += ["BEGIN:VEVENT", f"UID:{uid}", f"SUMMARY:{title}",
                  f"DTSTART:{s.strftime('%Y%m%dT%H%M%SZ')}", f"DTEND:{e.strftime('%Y%m%dT%H%M%SZ')}", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\\r\\n".join(lines)

def main():
    events = fetch_events()
    log.info("Fetched %d events", len(events))
    if not events:
        return
    ics = build_ics(events)
    import requests
    resp = requests.post(
        WORKTRACE_URL.rstrip("/") + "/ttt/import/ics",
        headers={"Authorization": f"Bearer {WORKTRACE_TOKEN}"},
        files={"file": ("calendar.ics", io.BytesIO(ics.encode()), "text/calendar")},
        timeout=30,
    )
    resp.raise_for_status()
    r = resp.json()
    log.info("SUCCESS — imported %d, failed %d", r.get("count",0), r.get("failed",0))

if __name__ == "__main__":
    main()
`
}

function makeWindowsScript(syncToken) {
  return `# Sync-OutlookToWorkTrace.ps1  —  auto-generated by WorkTrace
# Requirements: Outlook desktop app installed
# Run: powershell -ExecutionPolicy Bypass -File .\\Sync-OutlookToWorkTrace.ps1

$WORKTRACE_URL   = "${WORKTRACE_URL}"
$WORKTRACE_TOKEN = "${syncToken}"
$DAYS_BACK       = 7

Add-Type -AssemblyName "Microsoft.Office.Interop.Outlook" -ErrorAction SilentlyContinue
$outlook  = New-Object -ComObject Outlook.Application
$ns       = $outlook.GetNamespace("MAPI")
$calendar = $ns.GetDefaultFolder(9)  # olFolderCalendar

$start = (Get-Date).AddDays(-$DAYS_BACK).ToString("MM/dd/yyyy")
$end   = (Get-Date).AddDays(1).ToString("MM/dd/yyyy")
$items = $calendar.Items
$items.IncludeRecurrences = $true
$items.Sort("[Start]")
$filter = "[Start] >= '$start' AND [Start] <= '$end'"
$events = $items.Restrict($filter)

$ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WorkTrace//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n"
foreach ($e in $events) {
    $uid   = [guid]::NewGuid().ToString()
    $s     = $e.Start.ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $en    = $e.End.ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $title = $e.Subject -replace "[\\n\\r]", " "
    $ics  += "BEGIN:VEVENT\r\nUID:$uid\r\nSUMMARY:$title\r\nDTSTART:$s\r\nDTEND:$en\r\nEND:VEVENT\r\n"
}
$ics += "END:VCALENDAR"

$bytes    = [System.Text.Encoding]::UTF8.GetBytes($ics)
$boundary = "----WorkTraceBoundary"
$body     = "--$boundary\r\nContent-Disposition: form-data; name=\\"file\\"; filename=\\"calendar.ics\\"\r\nContent-Type: text/calendar\r\n\r\n" + $ics + "\r\n--$boundary--"
$headers  = @{ Authorization = "Bearer $WORKTRACE_TOKEN" }
$response = Invoke-RestMethod -Uri "$WORKTRACE_URL/ttt/import/ics" \`
    -Method POST -Headers $headers \`
    -ContentType "multipart/form-data; boundary=$boundary" \`
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
Write-Host "Imported: $($response.count)  Failed: $($response.failed)"
`
}

function SyncScriptDownload({ token }) {
  const [expanded, setExpanded] = useState(false)
  async function handleDownload(platform) {
    const script = platform === "mac" ? makeMacScript(token) : makeWindowsScript(token)
    const ext    = platform === "mac" ? "py" : "ps1"
    const blob   = new Blob([script], { type: "text/plain" })
    const url    = URL.createObjectURL(blob)
    const a      = document.createElement("a")
    a.href = url; a.download = `Sync-OutlookToWorkTrace.${ext}`; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div style={{ marginTop: 12, border: "1px solid #2d2d2d", borderRadius: 6, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ width: "100%", padding: "10px 14px", background: "#1c1c1c", border: "none", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#ccc", fontSize: 13 }}
      >
        <span>📅 Calendar Auto-Sync Setup</span>
        <span style={{ fontSize: 12, color: "#555" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ padding: "14px 16px", background: "#161616", borderTop: "1px solid #2d2d2d", fontSize: 13, color: "#aaa", display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            Download and run the sync script to automatically import your Outlook/Teams calendar events into WorkTrace. Run it once manually, then schedule it to run 3× daily.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => handleDownload("mac")}
              style={{ padding: "7px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              🍎 Download for macOS (.py)
            </button>
            <button onClick={() => handleDownload("windows")}
              style={{ padding: "7px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              🪟 Download for Windows (.ps1)
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
            macOS: <code style={{ background: "var(--surface-2)", padding: "1px 4px", borderRadius: 3 }}>pip install requests</code> then run the .py file. Schedule with launchd (see How to Use).
          </p>
        </div>
      )}
    </div>
  )
}
