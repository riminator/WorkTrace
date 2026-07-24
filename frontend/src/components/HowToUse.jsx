const code = { fontFamily: "monospace", fontSize: 11, background: "var(--surface)", padding: "1px 5px", borderRadius: 3, border: "1px solid var(--border)" };

export default function HowToUse() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Hero */}
      <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>Welcome to WorkTrace</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7 }}>
          WorkTrace has two main surfaces: the <strong style={{ color: "var(--text)" }}>Time Tracker</strong> for
          logging work hours, and the <strong style={{ color: "var(--text)" }}>Knowledge Base</strong> for uploading,
          searching, and chatting with your documents. This guide explains each feature and how they connect.
        </p>
      </div>

      {/* Time Tracker section */}
      <div className="card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, color: "#38bdf8" }}>⏱ Time Tracker</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <GuideItem
            icon="📊"
            title="Dashboard"
            description="Your overview: total hours logged, billable vs non-billable breakdown, hours by project and task type, and daily activity chart. Use the date range picker to zoom into any time window."
          />
          <GuideItem
            icon="📋"
            title="Time Entries"
            description="A filterable, editable table of every logged entry. You can inline-edit any field, bulk-delete entries, and filter by date range or project code. Use this to review and clean up what was auto-imported."
          />
          <GuideItem
            icon="📅"
            title="Calendar"
            description={<>A <strong>week-view calendar</strong> showing all your imported events as colour-coded blocks. Click any event to see full details — title, time, duration, project, organizer, and notes. Navigate weeks with the ‹ › arrows. An .ics drop zone at the bottom lets you import manually, and the auto-sync script keeps it updated daily with no manual work.</>}
          />
          <GuideItem
            icon="📥"
            title="Import"
            description="Import time entries from a CSV file. The CSV importer accepts the WorkTrace template format as well as Outlook/Google Calendar exports."
          />
          <GuideItem
            icon="📈"
            title="Reports"
            description="Pick a date range and export a summary CSV of all time entries — useful for billing, timesheets, or sharing with a manager."
          />

        </div>
      </div>

      {/* Knowledge Base section */}
      <div className="card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, color: "var(--accent)" }}>🗂 Knowledge Base</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <GuideItem
            icon="💬"
            title="Chat"
            description="Ask questions about your indexed documents in natural language. WorkTrace retrieves the most relevant chunks from your knowledge base and uses an AI model to generate a grounded answer with source citations. Conversation history is preserved across turns."
          />
          <GuideItem
            icon="🔍"
            title="Search"
            description="Run a semantic (meaning-based) search across all your documents. Results include a similarity score and an expandable snippet. You can filter by document type or source filename."
          />

          {/* Import tab sub-items — most important */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>📂</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Import (Documents)</div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                  The Import tab has three sub-sections:
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 32 }}>
              <SubItem
                title="📤 Upload Documents"
                description="Drag-and-drop any file (PDF, DOCX, TXT, image, code, CSV …) to index it into the knowledge base. Optionally set a project code and document type. Once indexed, the file is available in Search and Chat. It does NOT create a time entry."
              />
              <SubItem
                title="🎙️ Meeting Notes"
                description={<>Upload a meeting transcript or notes file. This does two things: <strong>(1)</strong> indexes the file into the knowledge base, and <strong>(2)</strong> generates an AI summary and automatically creates a time entry in the Time Tracker. Use this tab intentionally — not for regular documents.</>}
                warn
              />
              <SubItem
                title="📑 Indexed Sources"
                description="Lists all documents currently indexed in the knowledge base, with file type, chunk count, and a delete button to remove any source."
              />
            </div>
          </div>

          <GuideItem
            icon="💬"
            title="Feedback"
            description="Tracks thumbs-up / thumbs-down ratings on Chat responses. Useful for monitoring answer quality over time."
          />

        </div>
      </div>

      {/* Tips */}
      {/* Calendar auto-sync section */}
      <div className="card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, color: "#a78bfa" }}>📅 Calendar Auto-Sync</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 14 }}>
          The <strong style={{ color: "var(--text)" }}>Calendar</strong> tab lets you import events directly from any
          calendar app. For true hands-free sync, use the scripts below — they run once a day and push all your
          calendar events to WorkTrace automatically.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* macOS */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>🍎 macOS (Outlook / Teams / Google)</div>
            <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, marginBottom: 8 }}>
              Reads from macOS Calendar.app via AppleScript — no Entra app, no OAuth, no Microsoft Graph needed.
              Outlook for Mac syncs its events into Calendar.app automatically.
            </p>
            <ol style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 18, lineHeight: 2 }}>
              <li>Open Calendar.app and confirm your Outlook events are visible there</li>
              <li>Install the dependency: <code style={code}>pip install requests</code></li>
              <li>Test: <code style={code}>python3 scripts/Sync-OutlookToWorkTrace.py --list-calendars</code></li>
              <li>First run: <code style={code}>python3 scripts/Sync-OutlookToWorkTrace.py --days-back 30 --calendar-filter "Calendar"</code></li>
              <li>Auto-run on Terminal open: already wired into <code style={code}>~/.zshrc</code> — syncs once per day silently</li>
            </ol>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              Full guide: <code style={code}>docs/OutlookSync.md</code>
            </p>
          </div>

          {/* Windows */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>🪟 Windows (Classic / New Outlook)</div>
            <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, marginBottom: 8 }}>
              Uses Outlook COM automation — reads directly from the running Outlook process, no API needed.
            </p>
            <ol style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 18, lineHeight: 2 }}>
              <li>Copy <code style={code}>scripts/Sync-OutlookToWorkTrace.ps1</code> to your Windows machine</li>
              <li>Dry-run: <code style={code}>.\Sync-OutlookToWorkTrace.ps1 -DaysBack 3 -WhatIf</code></li>
              <li>Real run: <code style={code}>.\Sync-OutlookToWorkTrace.ps1 -DaysBack 7</code></li>
              <li>Schedule: import <code style={code}>scripts/WorkTraceSync-TaskScheduler.xml</code> into Task Scheduler</li>
            </ol>
          </div>

          {/* Manual ICS */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>📄 Manual .ics Import (any platform)</div>
            <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
              Export a <code style={code}>.ics</code> file from any calendar app and drop it in the{" "}
              <strong style={{ color: "var(--text)" }}>Calendar</strong> tab. Works with Outlook, Google Calendar, and Apple Calendar.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6 }}>
          <div style={{ fontSize: 12, color: "#0369a1", lineHeight: 1.7 }}>
            <strong>How user scoping works:</strong> Every imported event is tagged with your Supabase user ID
            (extracted from the JWT in your browser session). The sync scripts use the same long-lived JWT token
            configured in <code style={code}>scripts/Sync-OutlookToWorkTrace.py</code>. Entries are only ever
            visible to the account that imported them — other users see only their own data.
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="card">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>💡 Tips & gotchas</h3>
        <ul style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.8, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li><strong>Upload Documents vs Meeting Notes:</strong> Use <em>Upload Documents</em> for any file you just want searchable. Use <em>Meeting Notes</em> only when you want an automatic time entry created alongside indexing.</li>
          <li><strong>Re-index:</strong> If you update a file, check "Re-index existing files" before uploading to replace the old chunks.</li>
          <li><strong>Project codes:</strong> Consistent codes (e.g. <code>PROJ-001</code>) across uploads and time entries let you filter and report by project everywhere.</li>
          <li><strong>Calendar sync is safe to re-run:</strong> Duplicate events are silently skipped — re-running the sync script never creates double entries.</li>
          <li><strong>CSV export:</strong> The Reports tab exports time entries. Only entries created via Time Entries → Manual entry, Calendar, Import, or Meeting Notes upload appear there — regular document uploads do not.</li>
          <li><strong>Chat grounding:</strong> Answers are grounded in your indexed documents. If Chat says "I don't know", try uploading the relevant document first.</li>
        </ul>
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", paddingBottom: 8 }}>
        WorkTrace · personal document intelligence &amp; time tracking
      </div>
    </div>
  );
}

function GuideItem({ icon, title, description }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>{description}</div>
      </div>
    </div>
  );
}

function SubItem({ title, description, warn = false }) {
  return (
    <div style={{
      background: warn ? "#fff7ed" : "var(--surface-2)",
      border: `1px solid ${warn ? "#fed7aa" : "var(--border)"}`,
      borderRadius: 6,
      padding: "10px 12px",
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3, color: warn ? "#c2410c" : "var(--text)" }}>{title}</div>
      <div style={{ fontSize: 12, color: warn ? "#9a3412" : "var(--muted)", lineHeight: 1.7 }}>{description}</div>
    </div>
  );
}
