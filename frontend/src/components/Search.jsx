import { useState } from "react";
import { searchDocs } from "../api";

const FILE_TYPES = ["", "pdf", "text", "image", "docx", "generic"];

/** Highlight query terms inside a plain-text snippet. Returns an array of JSX spans. */
function HighlightedSnippet({ text, query }) {
  if (!text) return null;

  const stop = new Set(["the", "and", "for", "are", "was", "its", "with", "that",
    "this", "from", "have", "has", "had", "not", "but", "they", "you", "can"]);
  const terms = [...new Set(
    (query.match(/[a-zA-Z0-9]+/g) || [])
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 3 && !stop.has(t))
  )];

  if (terms.length === 0) return <>{text}</>;

  // Build a single regex that matches any term (case-insensitive)
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part)
          ? <mark key={i} className="snippet-highlight">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [fileType, setFileType] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());

  function toggleExpand(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setExpandedIds(new Set());
    try {
      const data = await searchDocs({ query, top_k: topK, file_type: fileType, source_filter: sourceFilter });
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2 className="section-title">Search</h2>
        <form onSubmit={handleSearch}>
          <div className="search-row">
            <input
              className="input"
              placeholder="Ask anything about your documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={loading || !query.trim()}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          <div className="filters">
            <div className="filter-group">
              <label className="filter-label">File type</label>
              <select className="select" value={fileType} onChange={(e) => setFileType(e.target.value)}>
                <option value="">All types</option>
                {FILE_TYPES.filter(Boolean).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label className="filter-label">Filter by filename</label>
              <input
                className="small-input"
                placeholder="e.g. policy, report…"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label className="filter-label">Results</label>
              <select className="select" value={topK} onChange={(e) => setTopK(Number(e.target.value))}>
                {[3, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>Top {n}</option>
                ))}
              </select>
            </div>
          </div>
        </form>
      </div>

      {error && <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>}

      {results !== null && (
        <div className="results">
          {results.length === 0 ? (
            <p className="empty">No results found.</p>
          ) : (
            results.map((r) => {
              const expanded = expandedIds.has(r.id);
              return (
                <div key={r.id} className="result-card">
                  <div className="result-meta">
                    <span className="score-badge">score {r.score.toFixed(4)}</span>
                    <span className="type-badge">{r.file_type}</span>
                    <span className="type-badge">chunk #{r.chunk_index}</span>
                  </div>
                  <div className="result-source">{r.source}</div>

                  {/* Snippet — relevant excerpt with highlights */}
                  <pre className="result-content snippet-text" style={{ marginTop: 10 }}>
                    <HighlightedSnippet text={r.snippet} query={query} />
                  </pre>

                  {/* Expand / collapse full chunk */}
                  {r.content !== r.snippet && (
                    <>
                      <button
                        className="snippet-toggle"
                        onClick={() => toggleExpand(r.id)}
                      >
                        {expanded ? "▲ Show less" : "▼ Show full chunk"}
                      </button>
                      {expanded && (
                        <pre className="result-content snippet-full" style={{ marginTop: 8 }}>
                          <HighlightedSnippet text={r.content} query={query} />
                        </pre>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
