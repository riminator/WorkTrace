import { useState, useEffect } from "react";
import { getEntries, updateEntry } from "../tttApi";

const PROJECT_COLORS = [
  "#2563eb", "#7c3aed", "#0891b2", "#059669",
  "#d97706", "#dc2626", "#db2777", "#65a30d",
];

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

const TASK_TYPES = ["meeting","development","planning","review","admin","learning","other"];

function EntryDrawer({ entry, token, onClose, onSaved }) {
  if (!entry) return null;

  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);

  const startFmt = formatTime(entry.startTime);
  const endFmt   = formatTime(entry.endTime);
  const timeRange = startFmt && endFmt ? `${startFmt} – ${endFmt}` : startFmt || null;

  const attendeeList = entry.attendees
    ? entry.attendees.split(",").map(a => a.trim()).filter(Boolean)
    : [];

  async function handleEditSave(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const updates = {
      date:            fd.get("date"),
      durationMinutes: parseFloat(fd.get("duration")) * 60,
      meetingTitle:    fd.get("title"),
      projectCode:     fd.get("project"),
      taskType:        fd.get("taskType"),
      description:     fd.get("description"),
      startTime:       fd.get("startTime") ? `${fd.get("date")}T${fd.get("startTime")}:00Z` : null,
      endTime:         fd.get("endTime")   ? `${fd.get("date")}T${fd.get("endTime")}:00Z`   : null,
    };
    setSaving(true);
    try {
      await updateEntry(entry.id, updates, token);
      setEditing(false);
      onSaved();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

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
        top: "var(--header-h)", right: 0, bottom: 0,
        width: 380,
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

        {/* Body — detail view */}
        {!editing && (
          <>
            <div style={{ padding: "4px 20px 8px", flex: 1 }}>
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
            {/* Edit button at the bottom */}
            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)" }}>
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={() => setEditing(true)}
              >
                Edit entry
              </button>
            </div>
          </>
        )}

        {/* Body — edit form */}
        {editing && (
          <form onSubmit={handleEditSave} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <label className="filter-label">Date</label>
                <input name="date" type="date" className="input" defaultValue={entry.date?.split("T")[0]} required />
              </div>
              <div style={{ minWidth: 0 }}>
                <label className="filter-label">Duration (hrs)</label>
                <input name="duration" type="number" step="0.25" min="0.25" className="input" defaultValue={(entry.durationMinutes / 60).toFixed(2)} required />
              </div>
              <div style={{ minWidth: 0 }}>
                <label className="filter-label">Start time</label>
                <input name="startTime" type="time" className="input" defaultValue={entry.startTime ? new Date(entry.startTime).toISOString().slice(11,16) : ""} />
              </div>
              <div style={{ minWidth: 0 }}>
                <label className="filter-label">End time</label>
                <input name="endTime" type="time" className="input" defaultValue={entry.endTime ? new Date(entry.endTime).toISOString().slice(11,16) : ""} />
              </div>
            </div>
            <div>
              <label className="filter-label">Title</label>
              <input name="title" type="text" className="input" defaultValue={entry.meetingTitle || ""} required />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <label className="filter-label">Project</label>
                <input name="project" type="text" className="input" defaultValue={entry.projectCode} required />
              </div>
              <div style={{ minWidth: 0 }}>
                <label className="filter-label">Task type</label>
                <select name="taskType" className="select" style={{ width: "100%" }} defaultValue={entry.taskType}>
                  {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="filter-label">Description</label>
              <textarea name="description" className="input" rows={4} style={{ resize: "vertical", width: "100%" }} defaultValue={entry.description || ""} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1 }}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

/* ── Carousel stat card ─────────────────────────────────────────── */
function CarouselStatCard({ slides, accent = false }) {
  const [idx, setIdx] = useState(0);
  const { label, value, sub } = slides[idx];
  const prev = () => setIdx(i => (i - 1 + slides.length) % slides.length);
  const next = () => setIdx(i => (i + 1) % slides.length);

  const arrowBtn = (onClick, symbol, label) => (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "0 4px",
        color: accent ? "rgba(255,255,255,0.7)" : "var(--muted)",
        fontSize: 14,
        lineHeight: 1,
        flexShrink: 0,
        transition: "color 0.1s",
      }}
      onMouseEnter={e => e.currentTarget.style.color = accent ? "#fff" : "var(--text)"}
      onMouseLeave={e => e.currentTarget.style.color = accent ? "rgba(255,255,255,0.7)" : "var(--muted)"}
    >{symbol}</button>
  );

  return (
    <div style={{
      background: accent ? "var(--accent)" : "var(--bg)",
      border: `1px solid ${accent ? "transparent" : "var(--border)"}`,
      borderRadius: 10,
      padding: "16px 14px 16px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 2,
      position: "relative",
    }}>
      {/* nav row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 4 }}>
        {arrowBtn(prev, "‹", "Previous stat")}
        {/* dots */}
        <div style={{ display: "flex", gap: 4, flex: 1, justifyContent: "center" }}>
          {slides.map((_, i) => (
            <div
              key={i}
              onClick={() => setIdx(i)}
              style={{
                width: 5, height: 5,
                borderRadius: "50%",
                cursor: "pointer",
                background: i === idx
                  ? (accent ? "#fff" : "var(--accent)")
                  : (accent ? "rgba(255,255,255,0.35)" : "var(--border)"),
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>
        {arrowBtn(next, "›", "Next stat")}
      </div>

      {/* value */}
      <div style={{
        fontSize: 26,
        fontWeight: 700,
        color: accent ? "#fff" : "var(--text)",
        letterSpacing: "-0.5px",
        lineHeight: 1.1,
      }}>{value}</div>

      {/* label */}
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

/* ── Section header with toggle pills ──────────────────────────── */
function SectionHeader({ title, options, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px" }}>
        {title}
      </div>
      <div style={{ display: "flex", gap: 2, background: "var(--surface)", borderRadius: 6, padding: 2 }}>
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 9px",
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: value === opt.value ? "var(--bg)" : "transparent",
              color: value === opt.value ? "var(--text)" : "var(--muted)",
              boxShadow: value === opt.value ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
            }}
          >{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

/* ── Main dashboard ─────────────────────────────────────────────── */
export default function TTTDashboard({ token }) {
  const [summary,       setSummary]       = useState(null);
  const [allEntries,    setAllEntries]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);

  // panel toggles
  const [entriesView,  setEntriesView]  = useState("recent"); // "recent" | "all"
  const [projectScope, setProjectScope] = useState("month");  // "month" | "alltime"

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      try {
        const entries = await getEntries({}, token);
        setAllEntries(entries);

        const now   = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        const end   = now.toISOString().split("T")[0];
        const monthEntries = entries.filter(e => e.date >= start && e.date <= end);

        // month stats
        const monthMin      = monthEntries.reduce((s, e) => s + e.durationMinutes, 0);
        const monthProjects = [...new Set(monthEntries.map(e => e.projectCode))];
        const monthBillable = monthEntries.filter(e => e.billable).reduce((s, e) => s + e.durationMinutes, 0);
        const monthByProj   = buildByProject(monthEntries);

        // all-time stats
        const totalMin      = entries.reduce((s, e) => s + e.durationMinutes, 0);
        const totalProjects = [...new Set(entries.map(e => e.projectCode))];
        const totalBillable = entries.filter(e => e.billable).reduce((s, e) => s + e.durationMinutes, 0);
        const allByProj     = buildByProject(entries);

        // average hours per day this month (days elapsed)
        const daysElapsed = Math.max(1, now.getDate());
        const avgPerDay   = monthMin / 60 / daysElapsed;

        // most active project this month
        const topProject = monthByProj[0]?.project || "—";

        setSummary({
          // month
          monthHours:   monthMin / 60,
          monthEntries: monthEntries.length,
          monthProjects: monthProjects.length,
          monthBillableHours: monthBillable / 60,
          avgHoursPerDay: avgPerDay,
          topProject,
          monthByProj,
          // all-time
          totalHours:   totalMin / 60,
          totalEntries: entries.length,
          totalProjects: totalProjects.length,
          totalBillableHours: totalBillable / 60,
          allByProj,
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

  // carousel slide definitions per card
  const card1Slides = [
    { label: "Hours this month",    value: summary.monthHours.toFixed(1),         sub: "tracked this month" },
    { label: "Hours all time",      value: summary.totalHours.toFixed(1),          sub: "across all entries" },
    { label: "Avg hours / day",     value: summary.avgHoursPerDay.toFixed(1),      sub: "this month so far" },
    { label: "Billable hours",      value: summary.monthBillableHours.toFixed(1),  sub: "billable this month" },
  ];

  const card2Slides = [
    { label: "Entries this month",  value: summary.monthEntries,    sub: "logged this month" },
    { label: "Total entries",       value: summary.totalEntries,    sub: "all time" },
    { label: "Billable hrs (all)",  value: summary.totalBillableHours.toFixed(1), sub: "billable all time" },
  ];

  const card3Slides = [
    { label: "Active projects",     value: summary.monthProjects,   sub: "this month" },
    { label: "Total projects",      value: summary.totalProjects,   sub: "all time" },
    { label: "Top project",         value: summary.topProject,      sub: "most hours this month" },
  ];

  // entries panel data — sort by date desc, then startTime desc within same date
  const sortedEntries = [...allEntries].sort((a, b) => {
    const dateA = a.date?.split("T")[0] ?? "";
    const dateB = b.date?.split("T")[0] ?? "";
    if (dateB !== dateA) return dateB.localeCompare(dateA);
    // same date — sort by startTime; entries without a time go last
    if (a.startTime && b.startTime) return b.startTime.localeCompare(a.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return 0;
  });
  const entriesToShow = entriesView === "recent"
    ? sortedEntries.slice(0, 8)
    : sortedEntries;

  // hours by project data
  const byProjectData    = projectScope === "month" ? summary.monthByProj : summary.allByProj;
  const maxHours         = byProjectData[0]?.hours || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stat cards — 3 carousel columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <CarouselStatCard accent slides={card1Slides} />
        <CarouselStatCard slides={card2Slides} />
        <CarouselStatCard slides={card3Slides} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Entries panel */}
        <div className="card" style={{ padding: "20px 22px", marginBottom: 0 }}>
          <SectionHeader
            title="Entries"
            options={[
              { label: "Recent", value: "recent" },
              { label: "All",    value: "all" },
            ]}
            value={entriesView}
            onChange={setEntriesView}
          />
          {entriesToShow.length === 0
            ? <p className="empty">No entries yet.</p>
            : (
              <div style={{ maxHeight: entriesView === "all" ? 420 : "none", overflowY: entriesView === "all" ? "auto" : "visible" }}>
                {entriesToShow.map((e, i) => (
                  <div
                    key={e.id}
                    onClick={() => setSelectedEntry(e)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "9px 8px",
                      borderRadius: 6,
                      borderBottom: i < entriesToShow.length - 1 ? "1px solid var(--border)" : "none",
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
                ))}
              </div>
            )
          }
        </div>

        {/* Hours by project */}
        <div className="card" style={{ padding: "20px 22px", marginBottom: 0 }}>
          <SectionHeader
            title="Hours by Project"
            options={[
              { label: "This month", value: "month" },
              { label: "All time",   value: "alltime" },
            ]}
            value={projectScope}
            onChange={setProjectScope}
          />
          {byProjectData.length === 0
            ? <p className="empty">No data yet.</p>
            : byProjectData.slice(0, 8).map((p, i) => (
              <div key={p.project} style={{ marginBottom: i < byProjectData.length - 1 ? 12 : 0 }}>
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

      <EntryDrawer
        entry={selectedEntry}
        token={token}
        onClose={() => setSelectedEntry(null)}
        onSaved={async () => {
          const entries = await getEntries({}, token);
          setAllEntries(entries);
        }}
      />
    </div>
  );
}

/* ── helpers ────────────────────────────────────────────────────── */
function buildByProject(entries) {
  return Object.entries(
    entries.reduce((acc, e) => {
      acc[e.projectCode] = (acc[e.projectCode] || 0) + e.durationMinutes;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .map(([project, mins]) => ({ project, hours: mins / 60 }));
}
