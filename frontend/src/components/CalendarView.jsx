import { useState, useEffect, useCallback } from "react";
import { getEntries } from "../tttApi";
import { importICS } from "../tttApi";
import { useDropzone } from "react-dropzone";

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
      setEntries(data);
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
