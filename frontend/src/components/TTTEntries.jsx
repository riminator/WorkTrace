import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getEntries, deleteEntry, bulkDeleteEntries, updateEntry, getProjects, createEntry, classifyMeeting } from "../tttApi";

const TASK_TYPES = ["meeting","development","planning","review","admin","learning","other"];

function formatDuration(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(d) {
  if (!d) return "";
  const [y, mo, day] = d.split("T")[0].split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TASK_TYPES_ADD = ["meeting","development","planning","review","admin","learning","other"];

/* ── Inline typeahead for the Add Entry panel ───────────────────────────── */
function Typeahead({ value, onChange, onSelect, suggestions, renderRow, placeholder, required, inputStyle }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleDown(e) {
      if (e.key === "Escape") { setOpen(false); return; }
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleDown);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleDown);
    };
  }, []);

  const filtered = suggestions.filter(s => !filter || s.label.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="text"
        className="input"
        value={open ? filter : value}
        onFocus={() => { setFilter(""); setOpen(true); }}
        onChange={e => { setFilter(e.target.value); onChange(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        required={required}
        style={inputStyle}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg)", border: "1.5px solid var(--border-focus)",
          borderRadius: "var(--radius)", boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
          zIndex: 300, maxHeight: 200, overflowY: "auto",
        }}>
          {filtered.map((item, i) => (
            <div
              key={i}
              onMouseDown={e => { e.preventDefault(); onSelect(item); setOpen(false); setFilter(""); }}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              {renderRow(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Add Entry inline panel ─────────────────────────────────────────────── */
function AddEntryPanel({ token, projects, pastEntries, onSaved, onCancel }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    startTime: "", endTime: "", duration: "",
    title: "", project: "", taskType: "meeting",
    billable: false, description: "",
  });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function calcDuration(start, end) {
    if (!start || !end) return;
    const hrs = (new Date(`2000-01-01T${end}`) - new Date(`2000-01-01T${start}`)) / 3600000;
    if (hrs > 0) set("duration", hrs.toFixed(2));
  }

  async function handleClassify() {
    if (!form.title) { setError("Enter a title first."); return; }
    setError(null);
    try {
      const cl = await classifyMeeting(form.title, null, token);
      setForm(f => ({ ...f, project: cl.projectCode, taskType: cl.taskType, billable: cl.billable }));
    } catch (e) { setError(e.message); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await createEntry({
        date:            form.date,
        durationMinutes: parseFloat(form.duration) * 60,
        meetingTitle:    form.title,
        projectCode:     form.project || "GENERAL",
        taskType:        form.taskType,
        billable:        form.billable,
        description:     form.description || null,
        startTime:       form.startTime ? `${form.date}T${form.startTime}:00Z` : null,
        endTime:         form.endTime   ? `${form.date}T${form.endTime}:00Z`   : null,
        confidence: 0.75, status: "logged",
      }, token);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const titleSuggestions = useMemo(() => {
    const seen = new Set();
    return pastEntries.filter(e => e.meetingTitle).filter(e => { if (seen.has(e.meetingTitle)) return false; seen.add(e.meetingTitle); return true; }).map(e => ({ label: e.meetingTitle, entry: e }));
  }, [pastEntries]);

  const projectSuggestions = useMemo(() => {
    const seen = new Set(projects);
    pastEntries.forEach(e => e.projectCode && seen.add(e.projectCode));
    return [...seen].sort().map(p => ({ label: p, entry: null }));
  }, [pastEntries, projects]);

  const row = { display: "grid", gap: 10 };

  return (
    <div style={{ background: "var(--accent-light)", border: "1.5px solid #c7d2fe", borderRadius: "var(--radius-lg)", padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", margin: 0 }}>Add New Entry</h3>
        <button type="button" className="modal-close" onClick={onCancel} style={{ fontSize: 18 }}>×</button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...row, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
          {[["Date","date","date",true],["Start","startTime","time",false],["End","endTime","time",false]].map(([label, key, type, req]) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label className="filter-label">{label}{req ? " *" : ""}</label>
              <input type={type} className="input" value={form[key]}
                onChange={e => {
                  set(key, e.target.value);
                  if (key === "startTime") calcDuration(e.target.value, form.endTime);
                  if (key === "endTime")   calcDuration(form.startTime, e.target.value);
                }} required={req} />
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label className="filter-label">Duration (hrs) *</label>
            <input type="number" className="input" step="0.25" min="0.25" value={form.duration}
              onChange={e => set("duration", e.target.value)} required />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label className="filter-label">Title *</label>
          <div style={{ display: "flex", gap: 8 }}>
            <Typeahead
              value={form.title}
              onChange={v => set("title", v)}
              onSelect={item => setForm(f => ({ ...f, title: item.entry.meetingTitle || "", project: item.entry.projectCode || f.project, taskType: item.entry.taskType || f.taskType, billable: item.entry.billable ?? f.billable, duration: item.entry.durationMinutes ? (item.entry.durationMinutes / 60).toFixed(2) : f.duration }))}
              suggestions={titleSuggestions}
              placeholder="e.g. Sprint Planning"
              required
              inputStyle={{ flex: 1 }}
              renderRow={item => <div style={{ fontSize: 13 }}>{item.label}<span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>{item.entry.projectCode} · {item.entry.taskType}</span></div>}
            />
            <button type="button" className="btn btn-outline" style={{ whiteSpace: "nowrap", flexShrink: 0, fontSize: 13 }} onClick={handleClassify}>
              Auto-classify
            </button>
          </div>
        </div>

        <div style={{ ...row, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label className="filter-label">Project *</label>
            <Typeahead
              value={form.project}
              onChange={v => set("project", v)}
              onSelect={item => set("project", item.label)}
              suggestions={projectSuggestions}
              placeholder="e.g. Honda"
              required
              renderRow={item => <div style={{ fontSize: 13 }}>{item.label}</div>}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label className="filter-label">Task type</label>
            <select className="select" value={form.taskType} onChange={e => set("taskType", e.target.value)}>
              {TASK_TYPES_ADD.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label className="filter-label">Billable</label>
            <select className="select" value={form.billable ? "true" : "false"} onChange={e => set("billable", e.target.value === "true")}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label className="filter-label">Description</label>
          <textarea className="input" rows={2} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional notes…" />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Entry"}</button>
          <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

export default function TTTEntries({ token }) {
  const [entries,    setEntries]    = useState([]);
  const [projects,   setProjects]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [selected,   setSelected]   = useState(new Set());
  const [editing,    setEditing]    = useState(null);
  const [showAdd,    setShowAdd]    = useState(false);
  const [filters,    setFilters]    = useState({ startDate: "", endDate: "", projectCode: "" });

  const load = useCallback(async (f = filters) => {
    setLoading(true); setError(null); setSelected(new Set());
    try {
      const data = await getEntries(
        { startDate: f.startDate || undefined, endDate: f.endDate || undefined, projectCode: f.projectCode || undefined },
        token,
      );
      // Sort by date desc, then startTime desc within the same day
      data.sort((a, b) => {
        const dateA = a.date?.split("T")[0] ?? "";
        const dateB = b.date?.split("T")[0] ?? "";
        if (dateB !== dateA) return dateB.localeCompare(dateA);
        if (a.startTime && b.startTime) return b.startTime.localeCompare(a.startTime);
        if (a.startTime) return -1;
        if (b.startTime) return 1;
        return 0;
      });
      setEntries(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [token, filters]);

  useEffect(() => {
    load();
    getProjects(token).then(setProjects).catch(() => {});
  }, [token]);

  function handleEntrySaved() {
    setShowAdd(false);
    load();
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll(e) {
    setSelected(e.target.checked ? new Set(entries.map(en => en.id)) : new Set());
  }

  async function handleDelete(id) {
    if (!confirm("Delete this entry?")) return;
    try { await deleteEntry(id, token); load(); }
    catch (e) { alert(e.message); }
  }

  async function handleBulkDelete() {
    if (!confirm(`Delete ${selected.size} entries?`)) return;
    try { await bulkDeleteEntries([...selected], token); load(); }
    catch (e) { alert(e.message); }
  }

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
    try {
      await updateEntry(editing.id, updates, token);
      setEditing(null);
      load();
    } catch (e) { alert(e.message); }
  }

  return (
    <div>
      {/* Inline Add Entry panel */}
      {showAdd && (
        <AddEntryPanel
          token={token}
          projects={projects}
          pastEntries={entries}
          onSaved={handleEntrySaved}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <div className="card">
        {/* Filters + Add button */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "flex-end" }}>
          <div>
            <label className="filter-label">Start</label>
            <input type="date" className="small-input" value={filters.startDate}
              onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div>
            <label className="filter-label">End</label>
            <input type="date" className="small-input" value={filters.endDate}
              onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))} />
          </div>
          <div>
            <label className="filter-label">Project</label>
            <select className="select" value={filters.projectCode}
              onChange={e => setFilters(f => ({ ...f, projectCode: e.target.value }))}>
              <option value="">All</option>
              {projects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => load(filters)}>Apply</button>
          <button className="btn btn-outline" onClick={() => { setFilters({ startDate: "", endDate: "", projectCode: "" }); load({ startDate: "", endDate: "", projectCode: "" }); }}>Clear</button>
          <button
            className="btn btn-primary"
            style={{ marginLeft: "auto", background: "var(--ttt)", fontSize: 13 }}
            onClick={() => { setShowAdd(s => !s); }}
          >
            {showAdd ? "− Cancel" : "+ Add Entry"}
          </button>
          {selected.size > 0 && (
            <button className="btn btn-danger" onClick={handleBulkDelete}>
              Delete {selected.size} selected
            </button>
          )}
        </div>

        {loading && <p className="loading">Loading…</p>}
        {error   && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {!loading && entries.length === 0 && <p className="empty">No entries found.</p>}

        {!loading && entries.length > 0 && (
          <div className="table-container" style={{ overflowX: "auto" }}>
            <table className="sources-table">
              <thead>
                <tr>
                  <th><input type="checkbox" onChange={toggleAll} checked={selected.size === entries.length && entries.length > 0} /></th>
                  <th>Date</th>
                  <th>Project</th>
                  <th>Title</th>
                  <th>Duration</th>
                  <th>Type</th>
                  <th>Billable</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id}>
                    <td><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDate(e.date)}</td>
                    <td><span className="type-badge">{e.projectCode}</span></td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.meetingTitle || "Untitled"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDuration(e.durationMinutes)}</td>
                    <td>{e.taskType}</td>
                    <td>{e.billable ? <span className="type-badge" style={{ background: "#dcfce7", color: "#15803d" }}>Yes</span> : <span className="type-badge">No</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-outline" style={{ fontSize: 12, padding: "3px 10px", marginRight: 4 }} onClick={() => setEditing(e)}>Edit</button>
                      <button className="btn btn-danger" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => handleDelete(e.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="modal active" onClick={e => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-content" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3>Edit Entry</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>
            <form onSubmit={handleEditSave} className="entry-form">
              <div className="form-grid">
                <div className="form-field">
                  <label className="filter-label">Date</label>
                  <input name="date" type="date" className="input" defaultValue={editing.date?.split("T")[0]} required />
                </div>
                <div className="form-field">
                  <label className="filter-label">Duration (hrs)</label>
                  <input name="duration" type="number" step="0.25" min="0.25" className="input" defaultValue={(editing.durationMinutes / 60).toFixed(2)} required />
                </div>
                <div className="form-field">
                  <label className="filter-label">Start time</label>
                  <input name="startTime" type="time" className="input" defaultValue={editing.startTime ? new Date(editing.startTime).toISOString().slice(11,16) : ""} />
                </div>
                <div className="form-field">
                  <label className="filter-label">End time</label>
                  <input name="endTime" type="time" className="input" defaultValue={editing.endTime ? new Date(editing.endTime).toISOString().slice(11,16) : ""} />
                </div>
              </div>
              <div className="form-field" style={{ marginTop: 10 }}>
                <label className="filter-label">Title</label>
                <input name="title" type="text" className="input" defaultValue={editing.meetingTitle || ""} required />
              </div>
              <div className="form-grid" style={{ marginTop: 10 }}>
                <div className="form-field">
                  <label className="filter-label">Project</label>
                  <input name="project" type="text" className="input" defaultValue={editing.projectCode} required />
                </div>
                <div className="form-field">
                  <label className="filter-label">Task type</label>
                  <select name="taskType" className="select" style={{ width: "100%" }} defaultValue={editing.taskType}>
                    {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-field" style={{ marginTop: 10 }}>
                <label className="filter-label">Description</label>
                <textarea name="description" className="input" rows={3} style={{ resize: "vertical", width: "100%" }} defaultValue={editing.description || ""} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button type="submit" className="btn btn-primary">Save</button>
                <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
