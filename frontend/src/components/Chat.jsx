import { useState, useRef, useEffect } from "react";
import { chatWithKB } from "../api";

export default function Chat() {
  const [messages, setMessages]   = useState([]);  // {role, content, sources?}
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const bottomRef                 = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    const userMsg = { role: "user", content: question };
    const history = messages.map(({ role, content }) => ({ role, content }));

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const data = await chatWithKB({ question, history });
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.answer, sources: data.sources },
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setMessages([]);
    setError(null);
  }

  return (
    <div className="chat-wrap">
      <div className="card" style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: "none" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Chat</h2>
          {messages.length > 0 && (
            <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={handleClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div className="chat-thread">
        {messages.length === 0 && (
          <p className="empty" style={{ paddingTop: 60 }}>
            Ask anything about your documents.
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble-wrap ${msg.role}`}>
            <div className={`chat-bubble ${msg.role}`}>
              <div className="chat-text">{msg.content}</div>
              {msg.sources?.length > 0 && (
                <details className="chat-sources">
                  <summary>{msg.sources.length} source{msg.sources.length > 1 ? "s" : ""}</summary>
                  <ul>
                    {msg.sources.map((s, si) => (
                      <li key={si}>
                        <span className="type-badge" style={{ marginRight: 6 }}>
                          score {s.score.toFixed(3)}
                        </span>
                        <span style={{ fontSize: 11, wordBreak: "break-all", color: "var(--muted)" }}>
                          {s.source.split("/").pop()} · chunk {s.chunk_index}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
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

        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13, padding: "8px 16px" }}>{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <form onSubmit={handleSend} className="chat-input-form">
          <input
            className="input"
            placeholder="Ask a question about your documents…"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
          />
          <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
