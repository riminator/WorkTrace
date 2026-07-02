import { useState, useEffect, useCallback } from "react";
import { getEntries, deleteEntry, bulkDeleteEntries, updateEntry, getProjects } from "../tttApi";

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

export default function TTTEntries({ token }) {
  const [entries,   setEntries]   = useState([]);
  const [projects,  setProjects]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [selected,  setSelected]  = useState(new Set());
  const [editing,   setEditing]   = useState(null);   // entry being edited
  const [filters,   setFilters]   = useState({ startDate: "", endDate: "", projectCode: "" });

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
      <div className="card">
        {/* Filters */}
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
          {selected.size > 0 && (
            <button className="btn btn-danger" style={{ marginLeft: "auto" }} onClick={handleBulkDelete}>
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
