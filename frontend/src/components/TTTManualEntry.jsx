import { useState, useEffect, useRef, useCallback } from "react";
import { createEntry, classifyMeeting, getProjects, getEntries } from "../tttApi";

const TASK_TYPES = ["meeting","development","planning","review","admin","learning","other"];

function Field({ label, required, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}{required && " *"}
      </label>
      {children}
    </div>
  );
}

/* ── Reusable typeahead dropdown ──────────────────────────────────────────── */
function Typeahead({ value, onChange, onSelect, suggestions, renderRow, placeholder, required, inputStyle, inputProps = {} }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click or Escape
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

  const filtered = suggestions.filter(s =>
    !filter || s.label.toLowerCase().includes(filter.toLowerCase())
  );

  function handleFocus() {
    setFilter("");
    setOpen(true);
  }

  function handleChange(e) {
    setFilter(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  }

  function handlePick(item) {
    onSelect(item);
    setOpen(false);
    setFilter("");
    inputRef.current?.blur();
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        className="input"
        value={open ? filter : value}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={e => {
          // If blur was caused by clicking inside the dropdown, don't close — mousedown handles it
          if (!wrapRef.current?.contains(e.relatedTarget)) {
            // small delay so click on item fires first
            setTimeout(() => setOpen(false), 120);
          }
        }}
        placeholder={placeholder}
        required={required}
        style={inputStyle}
        autoComplete="off"
        {...inputProps}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          background: "var(--bg)",
          border: "1.5px solid var(--border-focus)",
          borderRadius: "var(--radius)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
          zIndex: 300,
          maxHeight: 240,
          overflowY: "auto",
        }}>
          {filtered.map((item, i) => (
            <div
              key={i}
              onMouseDown={e => { e.preventDefault(); handlePick(item); }}
              style={{
                padding: "9px 12px",
                cursor: "pointer",
                borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                transition: "background 0.1s",
              }}
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

/* ── Main component ───────────────────────────────────────────────────────── */
export default function TTTManualEntry({ token }) {
  const [projects,    setProjects]    = useState([]);
  const [pastEntries, setPastEntries] = useState([]);  // raw entries for suggestions
  const [form, setForm] = useState({
    date:        new Date().toISOString().split("T")[0],
    startTime:   "",
    endTime:     "",
    duration:    "",
    title:       "",
    project:     "",
    taskType:    "meeting",
    billable:    false,
    description: "",
    organizer:   "",
    attendees:   "",
  });
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    getProjects(token).then(setProjects).catch(() => {});
    // Load recent entries for autocomplete (last 200, no date filter)
    getEntries({}, token).then(setPastEntries).catch(() => {});
  }, [token]);

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  function calcDuration(start, end) {
    if (!start || !end) return;
    const s = new Date(`2000-01-01T${start}`);
    const e = new Date(`2000-01-01T${end}`);
    const hrs = (e - s) / 3600000;
    if (hrs > 0) set("duration", hrs.toFixed(2));
  }

  async function handleClassify() {
    if (!form.title) { setError("Enter a title first."); return; }
    setError(null);
    try {
      const cl = await classifyMeeting(form.title, form.organizer || null, token);
      setForm(f => ({ ...f, project: cl.projectCode, taskType: cl.taskType, billable: cl.billable }));
    } catch (e) { setError(e.message); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError(null); setSuccess(false);
    try {
      await createEntry({
        date:            form.date,
        durationMinutes: parseFloat(form.duration) * 60,
        meetingTitle:    form.title,
        projectCode:     form.project || "GENERAL",
        taskType:        form.taskType,
        billable:        form.billable,
        description:     form.description || null,
        organizer:       form.organizer   || null,
        attendees:       form.attendees   || null,
        startTime:       form.startTime ? `${form.date}T${form.startTime}:00Z` : null,
        endTime:         form.endTime   ? `${form.date}T${form.endTime}:00Z`   : null,
        confidence:      0.75,
        status:          "logged",
      }, token);
      setSuccess(true);
      setForm(f => ({ ...f, title: "", description: "", organizer: "", attendees: "", startTime: "", endTime: "", duration: "", project: "" }));
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  // ── Suggestion lists ─────────────────────────────────────────────────────

  // Unique past titles, deduplicated, most-recent first
  const titleSuggestions = useCallback(() => {
    const seen = new Set();
    return pastEntries
      .filter(e => e.meetingTitle)
      .filter(e => { if (seen.has(e.meetingTitle)) return false; seen.add(e.meetingTitle); return true; })
      .map(e => ({ label: e.meetingTitle, entry: e }));
  }, [pastEntries])();

  // Unique project codes from entries + projects API list
  const projectSuggestions = useCallback(() => {
    const seen = new Set(projects);
    pastEntries.forEach(e => e.projectCode && seen.add(e.projectCode));
    return [...seen].sort().map(p => ({ label: p, entry: null }));
  }, [pastEntries, projects])();

  // When a past title is picked, fill all the related fields
  function handleTitleSelect(item) {
    const e = item.entry;
    setForm(f => ({
      ...f,
      title:       e.meetingTitle || "",
      project:     e.projectCode  || f.project,
      taskType:    e.taskType     || f.taskType,
      billable:    e.billable     ?? f.billable,
      description: e.description  || f.description,
      organizer:   e.organizer    || f.organizer,
      attendees:   e.attendees    || f.attendees,
      // fill duration from the past entry's minutes
      duration:    e.durationMinutes ? (e.durationMinutes / 60).toFixed(2) : f.duration,
    }));
  }

  function handleProjectSelect(item) {
    set("project", item.label);
  }

  const row = { display: "grid", gap: 12 };

  return (
    <div className="card" style={{ maxWidth: 700 }}>
      <h2 className="section-title">Add Manual Time Entry</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Row 1 — date + times + duration */}
        <div style={{ ...row, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
          <Field label="Date" required>
            <input type="date" className="input" value={form.date}
              onChange={e => set("date", e.target.value)} required />
          </Field>
          <Field label="Start time">
            <input type="time" className="input" value={form.startTime}
              onChange={e => { set("startTime", e.target.value); calcDuration(e.target.value, form.endTime); }} />
          </Field>
          <Field label="End time">
            <input type="time" className="input" value={form.endTime}
              onChange={e => { set("endTime", e.target.value); calcDuration(form.startTime, e.target.value); }} />
          </Field>
          <Field label="Duration (hrs)" required>
            <input type="number" className="input" step="0.25" min="0.25" value={form.duration}
              onChange={e => set("duration", e.target.value)} required />
          </Field>
        </div>

        {/* Row 2 — title + classify */}
        <Field label="Meeting / Task title" required>
          <div style={{ display: "flex", gap: 8 }}>
            <Typeahead
              value={form.title}
              onChange={v => set("title", v)}
              onSelect={handleTitleSelect}
              suggestions={titleSuggestions}
              placeholder="e.g., Sprint Planning Meeting"
              required
              inputStyle={{ flex: 1 }}
              renderRow={item => (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1, display: "flex", gap: 8 }}>
                    <span>{item.entry.projectCode}</span>
                    <span>·</span>
                    <span>{item.entry.taskType}</span>
                    {item.entry.durationMinutes && (
                      <>
                        <span>·</span>
                        <span>{(item.entry.durationMinutes / 60).toFixed(1)}h</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            />
            <button type="button" className="btn btn-outline" style={{ whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={handleClassify}>
              Auto-classify
            </button>
          </div>
        </Field>

        {/* Row 3 — project + task type + billable */}
        <div style={{ ...row, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <Field label="Project" required>
            <Typeahead
              value={form.project}
              onChange={v => set("project", v)}
              onSelect={handleProjectSelect}
              suggestions={projectSuggestions}
              placeholder="e.g., Honda"
              required
              renderRow={item => (
                <div style={{ fontSize: 13, color: "var(--text)" }}>{item.label}</div>
              )}
            />
          </Field>
          <Field label="Task type">
            <select className="select" value={form.taskType} onChange={e => set("taskType", e.target.value)}>
              {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Billable">
            <select className="select" value={form.billable ? "true" : "false"}
              onChange={e => set("billable", e.target.value === "true")}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </Field>
        </div>

        {/* Row 4 — description */}
        <Field label="Description">
          <textarea className="input" rows={3} value={form.description}
            onChange={e => set("description", e.target.value)} placeholder="Additional notes…" />
        </Field>

        {/* Row 5 — organizer + attendees */}
        <div style={{ ...row, gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Organizer">
            <input type="email" className="input" value={form.organizer}
              onChange={e => set("organizer", e.target.value)} placeholder="organizer@company.com" />
          </Field>
          <Field label="Attendees">
            <input type="text" className="input" value={form.attendees}
              onChange={e => set("attendees", e.target.value)} placeholder="Comma-separated" />
          </Field>
        </div>

        {error   && <p style={{ color: "var(--danger)",  fontSize: 13, margin: 0 }}>{error}</p>}
        {success && <p style={{ color: "var(--success)", fontSize: 13, margin: 0 }}>Entry saved successfully.</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Entry"}
          </button>
          <button type="button" className="btn btn-outline"
            onClick={() => { setSuccess(false); setError(null); setForm(f => ({ ...f, title: "", description: "", organizer: "", attendees: "", startTime: "", endTime: "", duration: "", project: "" })); }}>
            Reset
          </button>
        </div>

      </form>
    </div>
  );
}
