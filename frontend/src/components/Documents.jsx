import { useState } from "react";
import Upload from "./Upload";
import MeetingUpload from "./MeetingUpload";
import CalendarImport from "./CalendarImport";

export default function Documents({ token }) {
  const [subTab, setSubTab] = useState("upload");

  return (
    <div>
      {/* Sub-tab toggle */}
      <div style={{
        display: "flex",
        gap: 4,
        marginBottom: 16,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 4,
        width: "fit-content",
        flexWrap: "wrap",
      }}>
        <button
          className={`btn ${subTab === "upload" ? "btn-primary" : "btn-outline"}`}
          style={{ fontSize: 13, padding: "5px 16px", border: "none" }}
          onClick={() => setSubTab("upload")}
        >
          📤 Upload Documents
        </button>
        <button
          className={`btn ${subTab === "meeting" ? "btn-primary" : "btn-outline"}`}
          style={{ fontSize: 13, padding: "5px 16px", border: "none" }}
          onClick={() => setSubTab("meeting")}
        >
          🎙️ Meeting Notes
        </button>
        <button
          className={`btn ${subTab === "calendar" ? "btn-primary" : "btn-outline"}`}
          style={{ fontSize: 13, padding: "5px 16px", border: "none" }}
          onClick={() => setSubTab("calendar")}
        >
          📅 Import from Calendar
        </button>
      </div>

      {subTab === "upload"   && <Upload         token={token} />}
      {subTab === "meeting"  && <MeetingUpload  token={token} />}
      {subTab === "calendar" && <CalendarImport token={token} />}
    </div>
  );
}
