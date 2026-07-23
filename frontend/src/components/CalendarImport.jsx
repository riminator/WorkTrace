import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { importICS } from "../tttApi";

export default function CalendarImport({ token }) {
  const [file,   setFile]   = useState(null);
  const [status, setStatus] = useState("idle");  // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    accept: { "text/calendar": [".ics"] },
    onDrop: (files) => { if (files[0]) { setFile(files[0]); setStatus("idle"); setResult(null); setError(null); } },
  });

  async function handleImport() {
    if (!file) return;
    setStatus("loading"); setError(null); setResult(null);
    try {
      const res = await importICS(file, token);
      setResult(res);
      setStatus("done");
      setFile(null);
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }

  return (
    <div className="card">
      <h2 className="section-title">Import from Calendar</h2>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
        Export your calendar as an <strong>.ics</strong> file and drop it here.
        Each event becomes a time entry — duration, project code, and task type are auto-detected from the event title.
      </p>

      <div {...getRootProps()} className={`dropzone ${isDragActive ? "active" : ""}`} style={{ marginBottom: 16 }}>
        <input {...getInputProps()} />
        {file ? (
          <>
            <div className="dropzone-icon">📄</div>
            <div style={{ fontWeight: 600 }}>{file.name}</div>
            <div className="dropzone-hint">Click to replace</div>
          </>
        ) : (
          <>
            <div className="dropzone-icon">📅</div>
            <div>{isDragActive ? "Drop here…" : "Drag & drop your .ics file, or click to select"}</div>
            <div className="dropzone-hint">Outlook · Google Calendar · Apple Calendar</div>
          </>
        )}
      </div>

      <button
        className="btn btn-primary"
        onClick={handleImport}
        disabled={!file || status === "loading"}
      >
        {status === "loading" ? "Importing…" : "Import Calendar"}
      </button>

      {status === "done" && result && (
        <p style={{ color: "var(--success)", marginTop: 12, fontSize: 13, fontWeight: 600 }}>
          ✅ Imported {result.count} {result.count === 1 ? "entry" : "entries"}
          {result.failed ? ` (${result.failed} failed)` : ""}.
        </p>
      )}
      {status === "error" && (
        <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 13 }}>❌ {error}</p>
      )}

      <div style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>How to export your calendar</p>
        <ul style={{ fontSize: 13, paddingLeft: 18, color: "var(--muted)", lineHeight: 1.9 }}>
          <li><strong>Outlook:</strong> File → Save Calendar → choose date range → save as .ics</li>
          <li><strong>Google Calendar:</strong> Settings → Import &amp; Export → Export</li>
          <li><strong>Apple Calendar:</strong> File → Export → Export…</li>
        </ul>
      </div>
    </div>
  );
}
