import { useState, useEffect } from "react";
import { getSources } from "../api";
import { getEntries, getSummary } from "../tttApi";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function fetchAdminUsers(token) {
  const res = await fetch(`${BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

// ── sub-views ─────────────────────────────────────────────────────────────────

function UserSummary({ token, userId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getSummary({ viewAs: userId }, token)
      .then(setSummary)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, token]);

  if (loading) return <p className="loading">Loading summary…</p>;
  if (error)   return <p style={{ color: "var(--danger)" }}>{error}</p>;
  if (!summary) return null;

  const stats = [
    { label: "Total entries",     value: summary.totalEntries },
    { label: "Total hours",       value: (summary.totalHours ?? 0).toFixed(1) + " h" },
    { label: "Billable hours",    value: (summary.billableHours ?? 0).toFixed(1) + " h" },
    { label: "Projects",          value: summary.projectCount },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        {stats.map(({ label, value }) => (
          <div key={label} style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "12px 18px",
            minWidth: 130,
          }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      {summary.byProject?.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>By project</div>
          <table className="sources-table" style={{ marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Project</th>
                <th style={{ textAlign: "right" }}>Hours</th>
                <th style={{ textAlign: "right" }}>Entries</th>
                <th style={{ textAlign: "right" }}>%</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProject.map(p => (
                <tr key={p.project}>
                  <td><span className="type-badge">{p.project}</span></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.hours.toFixed(1)}</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>{p.count}</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>{p.percentage.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function UserEntries({ token, userId }) {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    setProjectFilter("");
    getEntries({ viewAs: userId }, token)
      .then(setEntries)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, token]);

  if (loading) return <p className="loading">Loading entries…</p>;
  if (error)   return <p style={{ color: "var(--danger)" }}>{error}</p>;
  if (!entries.length) return <p className="empty">No time entries for this user.</p>;

  const projects = [...new Set(entries.map(e => e.projectCode).filter(Boolean))].sort();
  const shown = projectFilter ? entries.filter(e => e.projectCode === projectFilter) : entries;

  return (
    <div>
      {/* filter bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{shown.length} of {entries.length} entries</span>
        <select
          className="select"
          style={{ width: "auto", fontSize: 12, padding: "4px 8px" }}
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="sources-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Title</th>
              <th>Project</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Hours</th>
              <th>Billable</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(e => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>{e.date}</td>
                <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.meetingTitle || "—"}</td>
                <td><span className="type-badge">{e.projectCode}</span></td>
                <td style={{ color: "var(--muted)" }}>{e.taskType}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(e.durationMinutes / 60).toFixed(1)}</td>
                <td style={{ color: e.billable ? "var(--success)" : "var(--muted)" }}>{e.billable ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserSources({ token, userId }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getSources(token, userId)
      .then(setSources)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, token]);

  if (loading) return <p className="loading">Loading sources…</p>;
  if (error)   return <p style={{ color: "var(--danger)" }}>{error}</p>;
  if (!sources.length) return <p className="empty">No documents indexed for this user.</p>;

  const total = sources.reduce((s, r) => s + r.chunks, 0);
  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        {sources.length} file(s) · {total} chunks
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="sources-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Source</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Chunks</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <tr key={s.source}>
                <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                <td className="source-path">{s.source}</td>
                <td><span className="type-badge">{s.file_type}</span></td>
                <td style={{ textAlign: "right" }}>{s.chunks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main AdminPanel ───────────────────────────────────────────────────────────

const VIEW_TABS = ["Summary", "Time Entries", "Documents"];

export default function AdminPanel({ token }) {
  const [users, setUsers]                   = useState([]);
  const [loadingUsers, setLoadingUsers]     = useState(true);
  const [usersError, setUsersError]         = useState(null);
  const [selectedUser, setSelectedUser]     = useState(null);
  const [viewTab, setViewTab]               = useState("Summary");
  const [search, setSearch]                 = useState("");

  useEffect(() => {
    setLoadingUsers(true);
    setUsersError(null);
    fetchAdminUsers(token)
      .then(list => {
        setUsers(list);
        if (list.length > 0) setSelectedUser(list[0].user_id);
      })
      .catch(e => setUsersError(e.message))
      .finally(() => setLoadingUsers(false));
  }, [token]);

  const filtered = users.filter(u =>
    u.user_id.toLowerCase().includes(search.toLowerCase()) ||
    (u.label || "").toLowerCase().includes(search.toLowerCase())
  );

  function shortId(uid) {
    return uid ? uid.slice(0, 8) + "…" : "—";
  }

  return (
    <div style={{ display: "flex", gap: 16, minHeight: 500, alignItems: "flex-start" }}>

      {/* ── Left: user list ─────────────────────────────────── */}
      <div style={{
        width: 220,
        flexShrink: 0,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "sticky",
        top: 12,
        maxHeight: "calc(100vh - 120px)",
      }}>
        <div style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted)", marginBottom: 8 }}>
            Users ({users.length})
          </div>
          <input
            className="input"
            style={{ fontSize: 12, padding: "6px 10px" }}
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
          {loadingUsers && <p className="loading" style={{ padding: "12px 8px" }}>Loading…</p>}
          {usersError   && <p style={{ color: "var(--danger)", padding: "8px", fontSize: 12 }}>{usersError}</p>}
          {!loadingUsers && filtered.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: 12, padding: "12px 8px" }}>No users found.</p>
          )}
          {filtered.map(u => {
            const active = selectedUser === u.user_id;
            return (
              <button
                key={u.user_id}
                onClick={() => { setSelectedUser(u.user_id); setViewTab("Summary"); }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: "var(--radius)",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                  fontSize: 12,
                  background: active ? "var(--accent-light)" : "transparent",
                  color:      active ? "var(--accent)"        : "var(--text-2)",
                  fontWeight: active ? 600 : 400,
                  transition: "background 0.1s",
                }}
              >
                <span style={{ display: "block", fontFamily: "monospace", fontSize: 11, color: active ? "var(--accent)" : "var(--muted)" }}>
                  {shortId(u.user_id)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: detail panel ─────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {!selectedUser ? (
          <div className="card"><p className="empty">Select a user to view their data.</p></div>
        ) : (
          <>
            {/* header card */}
            <div className="card" style={{ padding: "14px 20px", marginBottom: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Viewing data for</div>
                  <code style={{ fontSize: 12, color: "var(--accent)", background: "var(--accent-light)", padding: "3px 10px", borderRadius: 4 }}>
                    {selectedUser}
                  </code>
                </div>
                <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
                  {VIEW_TABS.map(t => (
                    <button
                      key={t}
                      onClick={() => setViewTab(t)}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        cursor: "pointer",
                        fontFamily: "var(--font)",
                        fontSize: 12,
                        fontWeight: viewTab === t ? 600 : 400,
                        background: viewTab === t ? "var(--accent-light)" : "var(--surface)",
                        color:      viewTab === t ? "var(--accent)"        : "var(--text-2)",
                        transition: "background 0.1s",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* content card */}
            <div className="card">
              {viewTab === "Summary"      && <UserSummary  token={token} userId={selectedUser} key={selectedUser + "-s"} />}
              {viewTab === "Time Entries" && <UserEntries  token={token} userId={selectedUser} key={selectedUser + "-e"} />}
              {viewTab === "Documents"    && <UserSources  token={token} userId={selectedUser} key={selectedUser + "-d"} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
