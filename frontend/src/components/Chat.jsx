import { useState, useRef, useEffect } from "react";
import { chatWithKB, submitFeedback } from "../api";
import MarkdownContent from "./MarkdownContent";

// ── localStorage helpers ────────────────────────────────────────────────────

const STORAGE_KEY   = "wt_chat_sessions";
const ACTIVE_KEY    = "wt_chat_active";

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function saveSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function newSession(label) {
  return { id: Date.now().toString(), label, messages: [], createdAt: new Date().toISOString() };
}

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const diff  = Math.floor((today - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)  return `${diff} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Chat({ token }) {
  const [sessions,       setSessions]       = useState(() => {
    const saved = loadSessions();
    if (saved.length === 0) {
      const first = newSession("New chat");
      saveSessions([first]);
      return [first];
    }
    return saved;
  });

  const [activeId,       setActiveId]       = useState(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    const all   = loadSessions();
    return (saved && all.find(s => s.id === saved)) ? saved : (all[0]?.id || null);
  });

  const [input,          setInput]          = useState("");
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [renamingId,     setRenamingId]     = useState(null);
  const [renameVal,      setRenameVal]      = useState("");
  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const bottomRef  = useRef(null);
  const renameRef  = useRef(null);

  const activeSession = sessions.find(s => s.id === activeId) || sessions[0];
  const messages      = activeSession?.messages || [];

  // persist whenever sessions change
  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => { if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); }, [activeId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  function updateSession(id, patch) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  function handleNewChat() {
    const s = newSession("New chat");
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
    setError(null);
  }

  function handleSwitch(id) {
    setActiveId(id);
    setError(null);
    setRenamingId(null);
  }

  function handleDelete(id, e) {
    e.stopPropagation();
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        const s = newSession("New chat");
        setActiveId(s.id);
        return [s];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }

  function startRename(id, currentLabel, e) {
    e.stopPropagation();
    setRenamingId(id);
    setRenameVal(currentLabel);
  }

  function commitRename(id) {
    const trimmed = renameVal.trim();
    if (trimmed) updateSession(id, { label: trimmed });
    setRenamingId(null);
  }

  async function handleSend(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    const userMsg = { role: "user", content: question };
    const history = messages.map(({ role, content }) => ({ role, content }));

    // Auto-title the session from the first user message
    const isFirstMsg = messages.length === 0;
    const currentLabel = activeSession?.label;

    updateSession(activeId, { messages: [...messages, userMsg] });
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const data = await chatWithKB({ question, history }, token);
      const assistantMsg = {
        role: "assistant", content: data.answer,
        sources: data.sources, question, feedback: null,
      };
      setSessions(prev => prev.map(s => {
        if (s.id !== activeId) return s;
        const newMsgs = [...s.messages, assistantMsg];
        // Auto-set label to first 40 chars of first user question
        const label = (isFirstMsg && currentLabel === "New chat")
          ? question.slice(0, 40) + (question.length > 40 ? "…" : "")
          : s.label;
        return { ...s, messages: newMsgs, label };
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFeedback(msgIdx, rating) {
    const msg = messages[msgIdx];
    if (!msg || msg.feedback) return;
    try {
      await submitFeedback({ question: msg.question, answer: msg.content, sources: msg.sources || [], rating }, token);
      updateSession(activeId, {
        messages: messages.map((m, i) => i === msgIdx ? { ...m, feedback: rating } : m),
      });
    } catch { /* silent */ }
  }

  function handleClearChat() {
    updateSession(activeId, { messages: [] });
    setError(null);
  }

  return (
    <div className="chat-layout">

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <div className={`chat-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="chat-sidebar-header">
          {sidebarOpen && <span className="chat-sidebar-title">History</span>}
          <button className="chat-sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? "Collapse" : "Expand"}>
            {sidebarOpen ? "‹" : "›"}
          </button>
        </div>

        {sidebarOpen && (
          <>
            <button className="chat-new-btn" onClick={handleNewChat}>+ New chat</button>

            <div className="chat-session-list">
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`chat-session-item ${s.id === activeId ? "active" : ""}`}
                  onClick={() => handleSwitch(s.id)}
                >
                  {renamingId === s.id ? (
                    <input
                      ref={renameRef}
                      className="chat-session-rename"
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={() => commitRename(s.id)}
                      onKeyDown={e => { if (e.key === "Enter") commitRename(s.id); if (e.key === "Escape") setRenamingId(null); }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="chat-session-info">
                        <span className="chat-session-label">{s.label}</span>
                        <span className="chat-session-date">{formatDate(s.createdAt)}</span>
                      </div>
                      <div className="chat-session-actions">
                        <button className="chat-session-btn" title="Rename" onClick={e => startRename(s.id, s.label, e)}>✎</button>
                        <button className="chat-session-btn danger" title="Delete" onClick={e => handleDelete(s.id, e)}>×</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Main chat area ───────────────────────────────────────── */}
      <div className="chat-wrap">
        <div className="card" style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              {activeSession?.label || "Chat"}
            </h2>
            {messages.length > 0 && (
              <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={handleClearChat}>
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="chat-thread">
          {messages.length === 0 && (
            <p className="empty" style={{ paddingTop: 60 }}>Ask anything about your documents.</p>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`chat-bubble-wrap ${msg.role}`}>
              <div className={`chat-bubble ${msg.role}`}>
                <div className="chat-text">
                  {msg.role === "assistant" ? <MarkdownContent content={msg.content} /> : msg.content}
                </div>
                {msg.sources?.length > 0 && (
                  <details className="chat-sources">
                    <summary>{msg.sources.length} source{msg.sources.length > 1 ? "s" : ""}</summary>
                    <ul>
                      {msg.sources.map((s, si) => (
                        <li key={si}>
                          <span className="type-badge" style={{ marginRight: 6 }}>score {s.score.toFixed(3)}</span>
                          <span style={{ fontSize: 11, wordBreak: "break-all", color: "var(--muted)" }}>
                            {s.source.split("/").pop()} · chunk {s.chunk_index}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {msg.role === "assistant" && (
                  <div className="chat-feedback">
                    {msg.feedback === null || msg.feedback === undefined ? (
                      <>
                        <span className="chat-feedback-label">Helpful?</span>
                        <button className="chat-feedback-btn" title="Thumbs up"  onClick={() => handleFeedback(i,  1)}>👍</button>
                        <button className="chat-feedback-btn" title="Thumbs down" onClick={() => handleFeedback(i, -1)}>👎</button>
                      </>
                    ) : (
                      <span className="chat-feedback-thanks">
                        {msg.feedback === 1 ? "👍 Thanks!" : "👎 Noted — we'll improve."}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-bubble-wrap assistant">
              <div className="chat-bubble assistant">
                <span className="chat-thinking">Thinking…</span>
              </div>
            </div>
          )}

          {error && <p style={{ color: "var(--danger)", fontSize: 13, padding: "8px 16px" }}>{error}</p>}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-bar">
          <form onSubmit={handleSend} className="chat-input-form">
            <input
              className="input"
              placeholder="Ask a question about your documents…"
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading}
            />
            <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>Send</button>
          </form>
        </div>
      </div>

    </div>
  );
}
