import { useState, useEffect } from "react";
import { getFeedbackStats } from "../api";

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function FeedbackStats({ token }) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [expanded, setExpanded] = useState(null);  // index of expanded low-rated row

  async function load() {
    setLoading(true); setError(null);
    try {
      setStats(await getFeedbackStats(token));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);

  if (loading) return <div className="card"><p className="loading">Loading feedback…</p></div>;
  if (error)   return <div className="card"><p style={{ color: "var(--danger)" }}>{error}</p></div>;
  if (!stats)  return null;

  const { total, thumbsUp, thumbsDown, score, lowRated } = stats;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header stats */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Chat Response Feedback</h2>
          <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={load}>Refresh</button>
        </div>

        {total === 0 ? (
          <p className="empty">No feedback yet. Rate chat responses with 👍 or 👎 to start collecting data.</p>
        ) : (
          <>
            {/* Score bar */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total ratings",  value: total },
                { label: "👍 Thumbs up",   value: thumbsUp },
                { label: "👎 Thumbs down", value: thumbsDown },
                { label: "Approval score", value: score !== null ? `${score}%` : "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "14px 16px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{value}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            {total > 0 && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${(thumbsUp / total) * 100}%`,
                    background: "var(--success)",
                    borderRadius: 4,
                    transition: "width 0.4s ease",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  <span>👍 {Math.round((thumbsUp / total) * 100)}% positive</span>
                  <span>👎 {Math.round((thumbsDown / total) * 100)}% negative</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Low-rated queries */}
      {lowRated?.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>👎 Low-rated responses</h3>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
            These responses were marked unhelpful. Use them to identify gaps in your knowledge base or prompt quality.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {lowRated.map((item, i) => (
              <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
                {/* Row header — always visible */}
                <div
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    cursor: "pointer",
                    background: expanded === i ? "var(--surface)" : "transparent",
                    transition: "background 0.1s",
                    gap: 12,
                  }}
                  onMouseEnter={e => { if (expanded !== i) e.currentTarget.style.background = "var(--surface)"; }}
                  onMouseLeave={e => { if (expanded !== i) e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.question}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{formatDate(item.createdAt)}</div>
                  </div>
                  <span style={{ color: "var(--muted)", fontSize: 12, flexShrink: 0 }}>{expanded === i ? "▲" : "▼"}</span>
                </div>

                {/* Expanded detail */}
                {expanded === i && (
                  <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Question</div>
                    <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 12 }}>{item.question}</div>

                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Model answer</div>
                    <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 12 }}>{item.answer}</div>

                    {item.sources?.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Sources used</div>
                        <ul style={{ paddingLeft: 16, fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
                          {item.sources.map((s, si) => (
                            <li key={si}>{typeof s === "string" ? s : `${s.source?.split("/").pop() ?? "?"} · chunk ${s.chunk_index} · score ${s.score?.toFixed(3)}`}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    {item.note && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Note</div>
                        <div style={{ fontSize: 13, color: "var(--text)" }}>{item.note}</div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
