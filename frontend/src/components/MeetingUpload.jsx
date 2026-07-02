import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { ingestMeeting, summarizeMeeting, agenticMeeting } from "../api";

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

const TOOL_META = {
  search_kb:  { label: "Search knowledge base", icon: "🔍" },
  lookup_ttt: { label: "Look up past TTT entries", icon: "📋" },
  classify:   { label: "Classify meeting",  icon: "🏷️" },
  synthesise: { label: "Synthesise summary", icon: "🧠" },
  push_ttt:   { label: "Push to Time Tracker", icon: "✅" },
};

export default function MeetingUpload({ token }) {
  const [file, setFile]             = useState(null);
  const [projectCode, setProjectCode] = useState("");
  const [organizer, setOrganizer]   = useState("");
  const [attendees, setAttendees]   = useState("");
  const [force, setForce]           = useState(false);
  const [mode, setMode]             = useState("standard"); // "standard" | "agent"
  const [status, setStatus]         = useState("idle");     // idle | ingesting | summarizing | done | error
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState(null);

  const onDrop = useCallback((accepted) => {
    if (accepted.length > 0) setFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "text/*": [".txt", ".md", ".vtt", ".srt"],
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setResult(null);

    // Step 1 — ingest (same for both modes)
    setStatus("ingesting");
    let ingestData;
    try {
      ingestData = await ingestMeeting({ file, force }, token);
    } catch (err) {
      setError(err.message);
      setStatus("error");
      return;
    }

    // Step 2 — summarize or agentic
    setStatus("summarizing");
    try {
      let data;
      if (mode === "agent") {
        data = await agenticMeeting({
          filename:     ingestData.filename,
          project_code: projectCode || undefined,
          organizer:    organizer   || undefined,
          attendees:    attendees   || undefined,
        }, token);
      } else {
        data = await summarizeMeeting({
          filename:     ingestData.filename,
          project_code: projectCode || undefined,
          organizer:    organizer   || undefined,
          attendees:    attendees   || undefined,
        }, token);
      }
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  function handleReset() {
    setFile(null);
    setProjectCode("");
    setOrganizer("");
    setAttendees("");
    setForce(false);
    setStatus("idle");
    setResult(null);
    setError(null);
  }

  const busy = status === "ingesting" || status === "summarizing";

  return (
    <div>
      <div className="card">
        <h2 className="section-title">📋 Upload Meeting Notes</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>
          Upload a meeting transcript or notes file. It will be indexed into the knowledge base
          and a time entry will be pushed to the Time Task Tracker automatically.
        </p>

        {/* Dropzone */}
        <div {...getRootProps()} className={`dropzone ${isDragActive ? "active" : ""}`}>
          <input {...getInputProps()} />
          {file ? (
            <>
              <div className="dropzone-icon">📄</div>
              <div style={{ fontWeight: 600 }}>{file.name}</div>
              <div className="dropzone-hint">{formatBytes(file.size)} · Click to replace</div>
            </>
          ) : (
            <>
              <div className="dropzone-icon">🎙️</div>
              <div>Drop meeting notes or transcript here, or click to select</div>
              <div className="dropzone-hint">TXT, MD, VTT, SRT, PDF, DOCX</div>
            </>
          )}
        </div>

        {/* Optional metadata */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 10 }}>
            Optional fields
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                Project code
              </label>
              <input
                className="input"
                placeholder="e.g. Honda, ACME"
                value={projectCode}
                onChange={(e) => setProjectCode(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                Organizer
              </label>
              <input
                className="input"
                placeholder="e.g. name@company.com"
                value={organizer}
                onChange={(e) => setOrganizer(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              Attendees
            </label>
            <input
              className="input"
              placeholder="e.g. Alice, Bob, Carol"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px" }}>Mode</span>
          <button
            type="button"
            className={`btn ${mode === "standard" ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 12, padding: "5px 14px" }}
            onClick={() => setMode("standard")}
            disabled={busy}
          >
            Standard RAG
          </button>
          <button
            type="button"
            className={`btn ${mode === "agent" ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 12, padding: "5px 14px" }}
            onClick={() => setMode("agent")}
            disabled={busy}
          >
            🤖 Agentic
          </button>
          {mode === "agent" && (
            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
              Runs 5 tool calls: search → history → classify → synthesise → push
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="upload-actions" style={{ marginTop: 14 }}>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!file || busy}
          >
            {status === "ingesting"   ? "Uploading…"   :
             status === "summarizing" ? (mode === "agent" ? "Agent running…" : "Summarizing…") :
             "Ingest & Push to TTT"}
          </button>
          {status !== "idle" && !busy && (
            <button className="btn btn-outline" onClick={handleReset}>
              Reset
            </button>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              disabled={busy}
            />
            Re-index if already uploaded
          </label>
        </div>
      </div>

      {/* In-progress status */}
      {busy && (
        <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            <span style={{ marginRight: 8 }}>
              {status === "ingesting" ? "⬆️" : "🧠"}
            </span>
            <strong style={{ color: "var(--text)" }}>
              {status === "ingesting"
                ? "Step 1 of 2 — Uploading & indexing…"
                : mode === "agent"
                  ? "Step 2 of 2 — Agent running tool calls…"
                  : "Step 2 of 2 — Generating summary…"}
            </strong>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {status === "ingesting"
                ? "Extracting text, creating embeddings, storing in knowledge base."
                : mode === "agent"
                  ? "Running: search KB → look up history → classify → synthesise → push to TTT. This may take 30–90 seconds."
                  : "Running RAG over the indexed content and pushing to Time Task Tracker. This may take 30–60 seconds."}
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {status === "done" && result && (
        <div className="card" style={{ borderLeft: "4px solid var(--success)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>✅ Done</h3>
            {result.ttt_entry_id && (
              <span className="type-badge" style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" }}>
                TTT entry: {result.ttt_entry_id.slice(0, 8)}…
              </span>
            )}
          </div>

          {result.ttt_error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: "var(--danger)" }}>
              ⚠️ TTT push failed: {result.ttt_error}
            </div>
          )}

          {/* Agent trace — only in agent mode */}
          {result.steps?.length > 0 && (
            <details className="agent-trace" open>
              <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer", marginBottom: 8 }}>
                🤖 Agent trace — {result.steps.length} tool calls
              </summary>
              <div className="agent-steps">
                {result.steps.map((step, i) => {
                  const meta = TOOL_META[step.tool] || { label: step.tool, icon: "⚙️" };
                  return (
                    <div key={i} className="agent-step">
                      <div className="agent-step-header">
                        <span className="agent-step-icon">{meta.icon}</span>
                        <span className="agent-step-tool">{meta.label}</span>
                        <span className="agent-step-num">#{i + 1}</span>
                      </div>
                      <div className="agent-step-io">
                        <div className="agent-step-input">
                          <span className="agent-step-label">in</span>
                          <code>{step.input}</code>
                        </div>
                        <div className="agent-step-output">
                          <span className="agent-step-label">out</span>
                          <span>{step.output}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 8, marginTop: result.steps ? 12 : 0 }}>
            Meeting summary
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text)" }}>
            {result.answer}
          </div>

          {result.sources?.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>
                {result.sources.length} source chunk{result.sources.length > 1 ? "s" : ""} used
              </summary>
              <ul style={{ marginTop: 6, paddingLeft: 16, fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                {result.sources.map((s, i) => (
                  <li key={i}>
                    {s.source.split("/").pop()} · chunk {s.chunk_index} · score {s.score.toFixed(3)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="card" style={{ borderLeft: "4px solid var(--danger)" }}>
          <p style={{ color: "var(--danger)", fontSize: 13 }}>❌ {error}</p>
        </div>
      )}
    </div>
  );
}
