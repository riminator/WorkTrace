import { useState, useEffect } from "react";
import { getEntries } from "../tttApi";

const PROJECT_COLORS = [
  "#2563eb", "#7c3aed", "#0891b2", "#059669",
  "#d97706", "#dc2626", "#db2777", "#65a30d",
];

function StatCard({ label, value, sub, accent = false }) {
  return (
    <div style={{
      background: accent ? "var(--accent)" : "var(--bg)",
      border: `1px solid ${accent ? "transparent" : "var(--border)"}`,
      borderRadius: 10,
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}>
      <div style={{
        fontSize: 26,
        fontWeight: 700,
        color: accent ? "#fff" : "var(--text)",
        letterSpacing: "-0.5px",
        lineHeight: 1.1,
      }}>{value}</div>
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: accent ? "rgba(255,255,255,0.85)" : "var(--text)",
        marginTop: 4,
      }}>{label}</div>
      {sub && (
        <div style={{
          fontSize: 11,
          color: accent ? "rgba(255,255,255,0.6)" : "var(--muted)",
          marginTop: 1,
        }}>{sub}</div>
      )}
    </div>
  );
}

function formatDuration(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(d) {
  if (!d) return "";
  const [y, mo, day] = d.split("T")[0].split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateFull(d) {
  if (!d) return "";
  const [y, mo, day] = d.split("T")[0].split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(t) {
  if (!t) return null;
  // t may be "HH:MM:SS" or "HH:MM"
  const [hh, mm] = t.split(":");
  const h = parseInt(hh, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${suffix}`;
}

function TaskTypePill({ type }) {
  const map = {
    meeting:  { bg: "#eff6ff", color: "#1d4ed8" },
    focus:    { bg: "#f0fdf4", color: "#15803d" },
    review:   { bg: "#fdf4ff", color: "#7e22ce" },
    admin:    { bg: "#fff7ed", color: "#c2410c" },
  };
  const style = map[type] || { bg: "var(--surface)", color: "var(--muted)" };
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: "1px 6px",
      borderRadius: 4,
      textTransform: "uppercase",
      letterSpacing: "0.4px",
      background: style.bg,
      color: style.color,
    }}>{type}</span>
  );
}

function DetailRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function EntryDrawer({ entry, onClose }) {
  if (!entry) return null;

  const startFmt = formatTime(entry.startTime);
  const endFmt   = formatTime(entry.endTime);
  const timeRange = startFmt && endFmt ? `${startFmt} – ${endFmt}` : startFmt || null;

  const attendeeList = entry.attendees
    ? entry.attendees.split(",").map(a => a.trim()).filter(Boolean)
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.25)",
          zIndex: 40,
        }}
      />
      {/* Drawer */}
      <div style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0,
        width: 360,
        background: "var(--bg)",
        borderLeft: "1px solid var(--border)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", lineHeight: 1.3, marginBottom: 6 }}>
              {entry.meetingTitle || "Untitled"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <TaskTypePill type={entry.taskType} />
              {entry.billable && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "#f0fdf4", color: "#15803d", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Billable
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none",
              cursor: "pointer", color: "var(--muted)",
              fontSize: 18, lineHeight: 1,
              padding: "2px 4px", flexShrink: 0,
            }}
            aria-label="Close"
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: "4px 20px 24px", flex: 1 }}>
          <DetailRow label="Date"     value={formatDateFull(entry.date)} />
          <DetailRow label="Duration" value={formatDuration(entry.durationMinutes)} />
          {timeRange && <DetailRow label="Time"     value={timeRange} />}
          <DetailRow label="Project"  value={entry.projectCode} />
          <DetailRow label="Organizer" value={entry.organizer} />
          {attendeeList.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Attendees</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                {attendeeList.map((a, i) => (
                  <div key={i} style={{ fontSize: 13, color: "var(--text)" }}>{a}</div>
                ))}
              </div>
            </div>
          )}
          {entry.description && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 0" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Summary / Notes</div>
              <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginTop: 2, whiteSpace: "pre-wrap" }}>
                {entry.description}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function TTTDashboard({ token }) {
  const [summary,       setSummary]     = useState(null);
  const [recent,        setRecent]      = useState([]);
  const [loading,       setLoading]     = useState(true);
  const [error,         setError]       = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      try {
        const entries = await getEntries({}, token);
        setRecent(entries.slice(0, 8));

        const now   = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        const end   = now.toISOString().split("T")[0];
        const monthEntries = entries.filter(e => e.date >= start && e.date <= end);
        const totalMin  = monthEntries.reduce((s, e) => s + e.durationMinutes, 0);
        const projects  = [...new Set(monthEntries.map(e => e.projectCode))];
        const byProject = Object.entries(
          monthEntries.reduce((acc, e) => {
            acc[e.projectCode] = (acc[e.projectCode] || 0) + e.durationMinutes;
            return acc;
          }, {})
        )
          .sort((a, b) => b[1] - a[1])
          .map(([project, mins]) => ({ project, hours: mins / 60 }));

        setSummary({
          totalHours:   totalMin / 60,
          totalEntries: monthEntries.length,
          projectCount: projects.length,
          byProject,
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  if (loading) return <div className="card"><p className="loading">Loading dashboard…</p></div>;
  if (error)   return <div className="card"><p style={{ color: "var(--danger)" }}>{error}</p></div>;

  const maxHours = summary.byProject[0]?.hours || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stat cards — 3 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <StatCard accent label="Hours this month" value={summary.totalHours.toFixed(1)} sub="all time this month" />
        <StatCard label="Total entries"   value={summary.totalEntries} sub="this month" />
        <StatCard label="Active projects" value={summary.projectCount} sub="this month" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Recent entries */}
        <div className="card" style={{ padding: "20px 22px", marginBottom: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 14 }}>
            Recent Entries
          </div>
          {recent.length === 0
            ? <p className="empty">No entries yet.</p>
            : recent.map((e, i) => (
              <div
                key={e.id}
                onClick={() => setSelectedEntry(e)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 8px",
                  borderRadius: 6,
                  borderBottom: i < recent.length - 1 ? "1px solid var(--border)" : "none",
                  gap: 10,
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={ev => ev.currentTarget.style.background = "var(--surface)"}
                onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {e.meetingTitle || "Untitled"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{e.projectCode}</span>
                    <span style={{ fontSize: 10, color: "var(--border)" }}>·</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatDate(e.date)}</span>
                    <TaskTypePill type={e.taskType} />
                  </div>
                </div>
                <div style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--text)",
                  background: "var(--surface)",
                  padding: "2px 8px",
                  borderRadius: 5,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}>
                  {formatDuration(e.durationMinutes)}
                </div>
              </div>
            ))
          }
        </div>

        {/* Hours by project */}
        <div className="card" style={{ padding: "20px 22px", marginBottom: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 14 }}>
            Hours by Project
          </div>
          {summary.byProject.length === 0
            ? <p className="empty">No data yet.</p>
            : summary.byProject.slice(0, 8).map((p, i) => (
              <div key={p.project} style={{ marginBottom: i < summary.byProject.length - 1 ? 12 : 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{p.project}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{p.hours.toFixed(1)}h</span>
                </div>
                <div style={{ height: 4, background: "var(--surface)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${(p.hours / maxHours) * 100}%`,
                    background: PROJECT_COLORS[i % PROJECT_COLORS.length],
                    borderRadius: 2,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <EntryDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
