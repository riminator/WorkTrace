import { useState, useEffect, useCallback } from "react";
import { getEntries, importICS } from "../tttApi";
import { useDropzone } from "react-dropzone";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── helpers ───────────────────────────────────────────────────────────────────

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
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

const TASK_COLORS = {
  meeting:     { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  development: { bg: "#dcfce7", border: "#22c55e", text: "#166534" },
  planning:    { bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  review:      { bg: "#fae8ff", border: "#a855f7", text: "#581c87" },
  admin:       { bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  learning:    { bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  other:       { bg: "#f1f5f9", border: "#94a3b8", text: "#334155" },
};

function taskColor(type) {
  return TASK_COLORS[type] || TASK_COLORS.other;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ── ICS import dropzone (compact) ────────────────────────────────────────────

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
    <div style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Import .ics file
      </div>
      <div
        {...getRootProps()}
        style={{
          border: `2px dashed ${isDragActive ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          padding: "12px 16px",
          textAlign: "center",
          cursor: "pointer",
          fontSize: 12,
          color: "var(--muted)",
          background: isDragActive ? "#f0f9ff" : "var(--surface)",
          transition: "all 0.15s",
        }}
      >
        <input {...getInputProps()} />
        {status === "loading" ? "Importing…" : isDragActive ? "Drop here…" : "Drop an .ics file or click to select"}
      </div>
      {msg && (
        <p style={{ fontSize: 12, marginTop: 6, color: status === "done" ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
          {msg}
        </p>
      )}
    </div>
  );
}

// ── Event detail popover ──────────────────────────────────────────────────────

function EventPopover({ entry, onClose }) {
  const c = taskColor(entry.taskType);
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 10, padding: 20, maxWidth: 380, width: "90%",
          borderTop: `4px solid ${c.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", lineHeight: 1.4, flex: 1, marginRight: 8 }}>
            {entry.meetingTitle}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--muted)", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--muted)" }}>
          <Row label="Date"     value={new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} />
          <Row label="Time"     value={entry.startTime ? `${fmtTime(entry.startTime)} – ${fmtTime(entry.endTime)}` : "—"} />
          <Row label="Duration" value={fmtDuration(entry.durationMinutes)} />
          <Row label="Project"  value={entry.projectCode} />
          <Row label="Type"     value={<span style={{ background: c.bg, color: c.text, padding: "1px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{entry.taskType}</span>} />
          {entry.organizer && <Row label="Organizer" value={entry.organizer} />}
          {entry.attendees  && <Row label="Attendees" value={entry.attendees} />}
          {entry.description && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>Notes</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, background: "var(--surface)", padding: 8, borderRadius: 6, maxHeight: 100, overflow: "auto" }}>
                {entry.description}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ width: 68, flexShrink: 0, fontWeight: 600, color: "var(--text)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ── Day column ────────────────────────────────────────────────────────────────

function DayColumn({ date, entries, today, onSelect }) {
  const isToday = isoDate(date) === isoDate(today);
  const dayEntries = entries
    .filter(e => e.date === isoDate(date))
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* header */}
      <div style={{
        padding: "6px 4px",
        textAlign: "center",
        borderBottom: "1px solid var(--border)",
        background: isToday ? "#eff6ff" : "var(--surface)",
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{DAY_LABELS[date.getDay()]}</div>
        <div style={{
          fontSize: 17, fontWeight: 700,
          color: isToday ? "var(--accent)" : "var(--text)",
          marginTop: 2,
        }}>
          {date.getDate()}
        </div>
      </div>

      {/* events */}
      <div style={{ flex: 1, padding: "4px 3px", display: "flex", flexDirection: "column", gap: 3, overflowY: "auto" }}>
        {dayEntries.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--border)", textAlign: "center", marginTop: 12 }}>—</div>
        )}
        {dayEntries.map(e => {
          const c = taskColor(e.taskType);
          return (
            <div
              key={e.id}
              onClick={() => onSelect(e)}
              style={{
                background: c.bg,
                borderLeft: `3px solid ${c.border}`,
                borderRadius: 4,
                padding: "4px 5px",
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1.4,
                transition: "opacity 0.1s",
              }}
              title={e.meetingTitle}
              onMouseEnter={ev => ev.currentTarget.style.opacity = "0.8"}
              onMouseLeave={ev => ev.currentTarget.style.opacity = "1"}
            >
              <div style={{ fontWeight: 600, color: c.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {e.meetingTitle}
              </div>
              <div style={{ color: c.text, opacity: 0.8, fontSize: 10 }}>
                {e.startTime ? fmtTime(e.startTime) : ""} · {fmtDuration(e.durationMinutes)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main CalendarView ─────────────────────────────────────────────────────────

export default function CalendarView({ token }) {
  const today    = new Date();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState(null);

  const weekEnd = addDays(weekStart, 6);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEntries({ startDate: isoDate(weekStart), endDate: isoDate(weekEnd) }, token);
      // Only show entries that have an actual start time — manual entries without
      // a time would display as 12:00 AM or epoch which is misleading
      setEntries(data.filter(e => e.startTime));
    } catch (_) {
      // silently fail — table shows empty
    } finally {
      setLoading(false);
    }
  }, [weekStart, token]);

  useEffect(() => { load(); }, [load]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const totalMins  = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
  const totalHours = (totalMins / 60).toFixed(1);

  const monthLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${MONTH_NAMES[weekStart.getMonth()].slice(0,3)} – ${MONTH_NAMES[weekEnd.getMonth()].slice(0,3)} ${weekEnd.getFullYear()}`;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── header bar ── */}
      <div className="card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>

          {/* nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setWeekStart(w => addDays(w, -7))} style={{ padding: "4px 10px" }}>‹</button>
            <button className="btn btn-secondary" onClick={() => setWeekStart(startOfWeek(today))} style={{ padding: "4px 10px", fontSize: 12 }}>Today</button>
            <button className="btn btn-secondary" onClick={() => setWeekStart(w => addDays(w, 7))}  style={{ padding: "4px 10px" }}>›</button>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginLeft: 4 }}>{monthLabel}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {isoDate(weekStart)} – {isoDate(weekEnd)}
            </span>
          </div>

          {/* summary */}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {loading && <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</span>}
            {!loading && (
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                <strong style={{ color: "var(--text)" }}>{entries.length}</strong> events ·{" "}
                <strong style={{ color: "var(--text)" }}>{totalHours}h</strong> total
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── week grid ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", minHeight: 520 }}>
          {days.map(d => (
            <DayColumn key={isoDate(d)} date={d} entries={entries} today={today} onSelect={setSelected} />
          ))}
        </div>
      </div>

      {/* ── sync script download ── */}
      <SyncScriptDownload token={token} />

      {/* ── ICS import at the bottom ── */}
      <div className="card">
        <IcsDropzone token={token} onImported={load} />
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
          Events auto-sync daily from Outlook / Teams via the calendar sync script — see <strong>How to Use → Calendar Auto-Sync</strong> for setup.
        </p>
      </div>

      {/* ── event detail popover ── */}
      {selected && <EventPopover entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Sync script download ──────────────────────────────────────────────────────

const WORKTRACE_URL = window.location.origin;

function makeMacScript(syncToken) {
  return `#!/usr/bin/env python3
"""
WorkTrace Calendar Sync — macOS
Reads events from Calendar.app via AppleScript and imports them into WorkTrace.
No Entra app, no OAuth required.

Requirements: pip install requests

First-run setup
  1. Outlook → Settings → Sync → enable "Sync Outlook calendar with macOS Calendar"
     Quit and reopen Outlook, wait ~2 min, then confirm events appear in Calendar.app.
  2. First script run: macOS will ask "Terminal wants access to your calendars" → click OK.
     If you missed it: System Settings → Privacy & Security → Calendars → toggle Terminal on.
  3. pip install requests
  4. python3 Sync-OutlookToWorkTrace.py --list-calendars
  5. python3 Sync-OutlookToWorkTrace.py --days-back 30 --calendar-filter "Calendar"
"""
import argparse, io, logging, os, subprocess, sys, uuid
from datetime import datetime, timedelta, timezone

LOG_FILE = os.path.expanduser("~/Library/Logs/WorkTraceSync.log")
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
logging.basicConfig(level=logging.INFO,
  format="[%(asctime)s] [%(levelname)s] %(message)s",
  handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(LOG_FILE, encoding="utf-8")])
log = logging.getLogger(__name__)

WORKTRACE_URL   = "${WORKTRACE_URL}"
WORKTRACE_TOKEN = "${syncToken}"

def _run_applescript(script):
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def _ics_dt(dt): return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
def _ics_escape(t): return (t or "").replace("\\\\","\\\\\\\\").replace(";","\\\\;").replace(",","\\\\,").replace("\\n","\\\\n").replace("\\r","\\\\n")
def _ics_fold(line):
    enc=line.encode("utf-8")
    if len(enc)<=75: return line
    parts,pos,first=[],0,True
    while pos<len(enc):
        lim=75 if first else 74; chunk=enc[pos:pos+lim]
        while len(chunk)>1 and (chunk[-1]&0xC0)==0x80: chunk=chunk[:-1]
        parts.append(("" if first else " ")+chunk.decode("utf-8")); pos+=len(chunk); first=False
    return "\\r\\n".join(parts)

def fetch_events(days_back, days_forward, cal_filter=None):
    now=datetime.now(); start=(now-timedelta(days=days_back)).strftime("%-m/%-d/%Y"); end=(now+timedelta(days=days_forward)).strftime("%-m/%-d/%Y")
    if cal_filter:
        cond=" or ".join(f'name of cal is "{c}"' for c in cal_filter)
        clause=f"if ({cond}) then"
    else: clause="if true then"
    script=f"""
set startDate to date "{start}"
set endDate to date "{end}"
set output to ""
tell application "Calendar"
    repeat with cal in calendars
        {clause}
            set evts to (every event of cal whose start date >= startDate and start date <= endDate)
            repeat with e in evts
                set t to summary of e
                set sd to start date of e
                set ed to end date of e
                set loc to ""; try; set loc to location of e; if loc is missing value then set loc to ""; end try
                set desc to ""; try; set desc to description of e; if desc is missing value then set desc to ""; end try
                set evtUid to uid of e
                set output to output & evtUid & "|" & t & "|" & (sd as string) & "|" & (ed as string) & "|" & loc & "|" & desc & "\\\\n"
            end repeat
        end if
    end repeat
end tell
return output"""
    raw=_run_applescript(script)
    if not raw: return []
    events=[]
    for line in raw.strip().splitlines():
        parts=line.split("|",5)
        if len(parts)<4: continue
        uid,title,start_s,end_s=parts[0],parts[1],parts[2],parts[3]
        desc=parts[5] if len(parts)>5 else ""
        def _parse(s):
            if ", " in s: s=s.split(", ",1)[1]
            for fmt in ("%B %d, %Y at %I:%M:%S %p","%B %d, %Y at %H:%M:%S","%B %d, %Y"):
                try: return datetime.strptime(s.strip(),fmt)
                except: pass
            raise ValueError(f"Cannot parse: {s!r}")
        try:
            s=_parse(start_s).replace(tzinfo=timezone.utc); en=_parse(end_s).replace(tzinfo=timezone.utc)
        except Exception as ex: log.warning("Skip %r: %s",title,ex); continue
        events.append({"uid":uid or str(uuid.uuid4()),"summary":title or "(No title)","start":s,"end":en,"description":desc[:500]})
    return events

def list_calendars():
    raw=_run_applescript('tell application "Calendar"\\n    set output to ""\\n    repeat with cal in calendars\\n        set output to output & name of cal & "\\\\n"\\n    end repeat\\n    return output\\nend tell')
    print("\\nAvailable calendars:")
    for n in raw.strip().splitlines():
        if n: print(f"  {n}")

def build_ics(events):
    lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//WorkTrace Sync//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH"]
    for ev in events:
        lines+=["BEGIN:VEVENT",f"UID:{ev['uid']}",_ics_fold(f"SUMMARY:{_ics_escape(ev['summary'])}"),
                f"DTSTART:{_ics_dt(ev['start'])}",f"DTEND:{_ics_dt(ev['end'])}"]
        if ev.get("description"): lines.append(_ics_fold(f"DESCRIPTION:{_ics_escape(ev['description'])}"))
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\\r\\n".join(lines)

def post_ics(ics, url, tok):
    import requests
    r=requests.post(url.rstrip("/")+"/api/ttt/import/ics",
        headers={"Authorization":f"Bearer {tok}"},
        files={"file":("calendar.ics",io.BytesIO(ics.encode("utf-8")),"text/calendar")},timeout=30)
    r.raise_for_status(); return r.json()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--days-back",type=int,default=7)
    p.add_argument("--days-forward",type=int,default=1)
    p.add_argument("--calendar-filter",type=str,default=None)
    p.add_argument("--list-calendars",action="store_true")
    p.add_argument("--whatif",action="store_true")
    args=p.parse_args()
    if args.list_calendars: list_calendars(); return
    log.info("Starting WorkTrace calendar sync (days_back=%d)",args.days_back)
    cal_filter=[c.strip() for c in args.calendar_filter.split(",")] if args.calendar_filter else None
    events=fetch_events(args.days_back,args.days_forward,cal_filter)
    log.info("Fetched %d events",len(events))
    if not events: log.warning("No events found."); return
    ics=build_ics(events)
    if args.whatif: print(ics); return
    result=post_ics(ics,WORKTRACE_URL,WORKTRACE_TOKEN)
    log.info("SUCCESS — imported %d, failed %d",result.get("count",0),result.get("failed",0))

if __name__=="__main__": main()

# ── Auto-run setup (launchd — recommended) ────────────────────────────────────
# Runs automatically at 6 AM, 12 PM, and 6 PM Mon-Fri via launchd.
# Save this script to ~/WorkTrace-Sync/, then run:
#
#   cp com.worktrace.outlooksync.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.worktrace.outlooksync.plist
#
# ── OR: add to ~/.zshrc to sync up to 3× per day when Terminal opens ──────────
#
# _worktrace_sync() {
#   local slot
#   local h=$(date +%H)
#   if   (( h < 12 )); then slot="AM"
#   elif (( h < 18 )); then slot="PM"
#   else                    slot="EVE"
#   fi
#   local stamp="$HOME/.worktrace_last_sync_${slot}_$(date +%Y-%m-%d)"
#   if [[ ! -f "$stamp" ]]; then
#     echo "[WorkTrace] Syncing calendar..."
#     python3 ~/WorkTrace-Sync/Sync-OutlookToWorkTrace.py --days-back 1 --calendar-filter "Calendar" >> "$HOME/Library/Logs/WorkTraceSync.log" 2>&1 &
#     touch "$stamp"
#   fi
# }
# _worktrace_sync
`;
}

function makeWindowsScript(syncToken) {
  return `#Requires -Version 5.1
<#
.SYNOPSIS  WorkTrace Calendar Sync — Windows
.DESCRIPTION
  Reads Outlook calendar events via COM automation and imports them into WorkTrace.
  No Entra app, no OAuth required.
  Run: .\\Sync-OutlookToWorkTrace.ps1
  Schedule: import WorkTraceSync-TaskScheduler.xml into Task Scheduler
#>
param(
    [int]    $DaysBack    = 7,
    [int]    $DaysForward = 1,
    [string] $WorkTraceUrl = "${WORKTRACE_URL}",
    [string] $Token        = "${syncToken}",
    [string] $LogFile      = "$env:TEMP\\WorkTraceSync.log",
    [switch] $WhatIf
)
Set-StrictMode -Version Latest; $ErrorActionPreference = "Stop"
function Write-Log { param([string]$m,[string]$l="INFO"); $line="[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [$l] $m"; Write-Host $line; Add-Content -Path $LogFile -Value $line -Encoding UTF8 }
function Format-IcsDateTime { param([System.DateTime]$dt); return $dt.ToUniversalTime().ToString("yyyyMMdd\\THHmmss\\Z") }
function Escape-IcsText { param([string]$t); if(!$t){return ""}; $t=$t-replace"\\\\","\\\\\\\\"; $t=$t-replace";","\\\\;"; $t=$t-replace",","\\\\,"; $t=$t-replace"\`r\`n","\\\\n"; $t=$t-replace"\`n","\\\\n"; return $t }

Write-Log "Starting WorkTrace calendar sync (DaysBack=$DaysBack)"
try { $outlook=[System.Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application") }
catch { $outlook=New-Object -ComObject Outlook.Application }
$ns=$outlook.GetNamespace("MAPI"); $cal=$ns.GetDefaultFolder(9)
$items=$cal.Items; $items.IncludeRecurrences=$true; $items.Sort("[Start]")
$start=(Get-Date).Date.AddDays(-$DaysBack); $end=(Get-Date).Date.AddDays($DaysForward+1)
$filtered=$items.Restrict("[Start] >= '$(${start}.ToString('MM/dd/yyyy HH:mm'))' AND [Start] < '$(${end}.ToString('MM/dd/yyyy HH:mm'))'")
Write-Log "Found $($filtered.Count) items"
$icsLines=[System.Collections.Generic.List[string]]::new()
$icsLines.AddRange([string[]]@("BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//WorkTrace Sync//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH"))
$count=0
foreach($item in $filtered){
  if($item.Class -ne 26){continue}
  if($item.ResponseStatus -eq 4){continue}
  $uid=$item.GlobalAppointmentID; if(!$uid){$uid=[System.Guid]::NewGuid().ToString()}
  $summary=Escape-IcsText $item.Subject; $org=""; try{$org=$item.Organizer}catch{}
  $icsLines.Add("BEGIN:VEVENT"); $icsLines.Add("UID:$uid")
  $icsLines.Add("SUMMARY:$summary"); $icsLines.Add("DTSTART:$(Format-IcsDateTime $item.Start)")
  $icsLines.Add("DTEND:$(Format-IcsDateTime $item.End)")
  if($org){$icsLines.Add("ORGANIZER;CN=$org:mailto:$org")}
  $icsLines.Add("END:VEVENT"); $count++
}
$icsLines.Add("END:VCALENDAR")
$icsContent=$icsLines -join "\`r\`n"
Write-Log "Built ICS with $count events"
if($count -eq 0){Write-Log "Nothing to import."; exit 0}
if($WhatIf){Write-Host $icsContent; exit 0}
$boundary=[System.Guid]::NewGuid().ToString("N"); $CRLF="\`r\`n"
$header="--$boundary$CRLF\Content-Disposition: form-data; name=\`"file\`"; filename=\`"calendar.ics\`"$CRLF\Content-Type: text/calendar$CRLF$CRLF"
$hBytes=[System.Text.Encoding]::UTF8.GetBytes($header)
$iBytes=[System.Text.Encoding]::UTF8.GetBytes($icsContent)
$fBytes=[System.Text.Encoding]::UTF8.GetBytes("$CRLF--$boundary--$CRLF")
$body=New-Object byte[]($hBytes.Length+$iBytes.Length+$fBytes.Length)
[System.Buffer]::BlockCopy($hBytes,0,$body,0,$hBytes.Length)
[System.Buffer]::BlockCopy($iBytes,0,$body,$hBytes.Length,$iBytes.Length)
[System.Buffer]::BlockCopy($fBytes,0,$body,$hBytes.Length+$iBytes.Length,$fBytes.Length)
$resp=Invoke-RestMethod -Uri "$($WorkTraceUrl.TrimEnd('/'))/api/ttt/import/ics" -Method POST -Headers @{"Authorization"="Bearer $Token";"Content-Type"="multipart/form-data; boundary=$boundary"} -Body $body
Write-Log "SUCCESS — imported $($resp.count) entries, $($resp.failed) failed"
`;
}

function SyncScriptDownload({ token }) {
  const [platform,  setPlatform]  = useState("mac");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [copied,    setCopied]    = useState(false);

  async function handleDownload() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/me/sync-token`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { token: syncToken } = await res.json();

      const isMac = platform === "mac";
      const content  = isMac ? makeMacScript(syncToken) : makeWindowsScript(syncToken);
      const filename = isMac ? "Sync-OutlookToWorkTrace.py" : "Sync-OutlookToWorkTrace.ps1";
      const mime     = isMac ? "text/x-python" : "text/plain";

      const blob = new Blob([content], { type: mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginBottom: 6 }}>📥 Download Sync Script</h2>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
        Download a pre-configured script that automatically imports your Outlook / Teams calendar events
        into WorkTrace every day. Your personal token is already baked in — just download, run once, and you're done.
      </p>

      {/* Platform picker */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["mac", "🍎 macOS"], ["windows", "🪟 Windows"]].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setPlatform(val)}
            className={`btn ${platform === val ? "btn-primary" : "btn-secondary"}`}
            style={{ fontSize: 13 }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Instructions */}
      {platform === "mac" ? (
        <ol style={{ fontSize: 13, color: "var(--muted)", paddingLeft: 18, lineHeight: 2, marginBottom: 16 }}>
          <li>
            <strong>Enable Outlook → Calendar.app sync (one-time):</strong> Open Outlook → menu bar <strong>Outlook → Settings</strong> → <strong>Sync</strong> → enable <em>"Sync Outlook calendar with macOS Calendar"</em>. Quit and reopen Outlook, wait ~2 min, then open <strong>Calendar.app</strong> and confirm your Exchange/work events appear under an <em>Exchange</em> account in the sidebar.
          </li>
          <li>
            <strong>Grant calendar access (one-time):</strong> The first time the script runs macOS will show a dialog — <em>"Terminal wants access to your calendars"</em> — click <strong>OK</strong>. If you missed it: <strong>Apple menu → System Settings → Privacy &amp; Security → Calendars</strong> → toggle <strong>Terminal</strong> (or Python) on.
          </li>
          <li>Install the only dependency: <code style={codeStyle}>pip install requests</code></li>
          <li>Download the script below and save it anywhere (e.g. <code style={codeStyle}>~/Downloads/</code>)</li>
          <li>List your calendars: <code style={codeStyle}>python3 Sync-OutlookToWorkTrace.py --list-calendars</code></li>
          <li>First-run backfill: <code style={codeStyle}>python3 Sync-OutlookToWorkTrace.py --days-back 30 --calendar-filter "Calendar"</code></li>
          <li>For daily auto-sync, add the <code style={codeStyle}>_worktrace_sync</code> snippet (in the script comments) to your <code style={codeStyle}>~/.zshrc</code></li>
        </ol>
      ) : (
        <ol style={{ fontSize: 13, color: "var(--muted)", paddingLeft: 18, lineHeight: 2, marginBottom: 16 }}>
          <li>Outlook for Windows must be installed and open</li>
          <li>Download the script below and save it anywhere</li>
          <li>Right-click → Run with PowerShell, or: <code style={codeStyle}>.\Sync-OutlookToWorkTrace.ps1 -DaysBack 7</code></li>
          <li>To schedule daily: open Task Scheduler → Create Basic Task → point it at this script</li>
        </ol>
      )}

      <button
        className="btn btn-primary"
        onClick={handleDownload}
        disabled={loading}
        style={{ fontSize: 13 }}
      >
        {loading ? "Generating…" : `Download ${platform === "mac" ? ".py" : ".ps1"} script`}
      </button>

      {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>❌ {error}</p>}

      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 12, lineHeight: 1.6 }}>
        The script contains a personal token scoped to your account. Keep it private — do not share it or commit it to a repo.
      </p>
    </div>
  );
}

const codeStyle = { fontFamily: "monospace", fontSize: 11, background: "var(--surface)", padding: "1px 5px", borderRadius: 3, border: "1px solid var(--border)" };
