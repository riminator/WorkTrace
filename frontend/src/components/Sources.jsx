import { useState, useEffect } from "react";
import { getSources, deleteSource } from "../api";

export default function Sources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSources(await getSources());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(source) {
    if (!confirm(`Delete all chunks for:\n${source}?`)) return;
    setDeleting(source);
    try {
      await deleteSource(source);
      setSources((prev) => prev.filter((s) => s.source !== source));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(null);
    }
  }

  const total = sources.reduce((s, r) => s + r.chunks, 0);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            Indexed Sources
            {sources.length > 0 && (
              <span style={{ fontSize: 13, fontWeight: 400, color: "var(--muted)", marginLeft: 10 }}>
                {sources.length} file(s) · {total} chunks
              </span>
            )}
          </h2>
          <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={load}>
            Refresh
          </button>
        </div>

        {loading && <p className="loading">Loading…</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {!loading && sources.length === 0 && (
          <p className="empty">No documents indexed yet. Upload some files first.</p>
        )}

        {!loading && sources.length > 0 && (
          <table className="sources-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Source</th>
                <th>Type</th>
                <th>Chunks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => (
                <tr key={s.source}>
                  <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                  <td className="source-path">{s.source}</td>
                  <td><span className="type-badge">{s.file_type}</span></td>
                  <td style={{ textAlign: "right" }}>{s.chunks}</td>
                  <td>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDelete(s.source)}
                      disabled={deleting === s.source}
                    >
                      {deleting === s.source ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
