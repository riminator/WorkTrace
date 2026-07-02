import { useState, useRef, useEffect } from "react";
import Upload from "./components/Upload";
import Search from "./components/Search";
import Sources from "./components/Sources";
import Chat from "./components/Chat";
import MeetingUpload from "./components/MeetingUpload";
import LoginPage from "./components/LoginPage";
import TTTDashboard from "./components/TTTDashboard";
import TTTEntries from "./components/TTTEntries";
import TTTManualEntry from "./components/TTTManualEntry";
import TTTImport from "./components/TTTImport";
import TTTReports from "./components/TTTReports";
import { useSession, useAccessToken } from "./context/AuthContext";
import { supabase } from "./supabaseClient";
import "./App.css";

const KB_TABS  = ["Chat", "Search", "Upload", "Meeting", "Sources"];
const TTT_TABS = ["Dashboard", "Time Entries", "Manual Entry", "Import", "Reports"];

export default function App() {
  const [tab, setTab]           = useState("Dashboard");  // default to Dashboard
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef                 = useRef(null);
  const session = useSession();
  const token   = useAccessToken();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function switchTab(t) {
    setTab(t);
    setMenuOpen(false);
  }

  if (session === undefined) return <div className="app-loading">Loading…</div>;
  if (!session)              return <LoginPage />;

  const isTTT = TTT_TABS.includes(tab);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">

          {/* ── Row 1: logo + desktop nav + user bar ── */}
          <div className="header-row1">
            <h1 className="logo">Work<span>Trace</span></h1>

            {/* Desktop nav */}
            <nav className="nav-desktop">
              <div className="nav-group">
                <span className="nav-group-label ttt-label">Time Tracker</span>
                {TTT_TABS.map(t => (
                  <button key={t} className={`tab-btn ttt-tab ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>{t}</button>
                ))}
              </div>
              <div className="nav-divider" />
              <div className="nav-group">
                <span className="nav-group-label">Knowledge Base</span>
                {KB_TABS.map(t => (
                  <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>{t}</button>
                ))}
              </div>
            </nav>

            <div className="user-bar">
              <span className="user-email">{session.user.email}</span>
              <button className="logout-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>

              {/* Mobile hamburger */}
              <button className="hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
                <span /><span /><span />
              </button>
            </div>
          </div>

          {/* Mobile dropdown */}
          {menuOpen && (
            <div className="mobile-menu" ref={menuRef}>
              <div className="mobile-menu-section">
                <span className="mobile-menu-label">Knowledge Base</span>
                {KB_TABS.map(t => (
                  <button key={t} className={`mobile-tab ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>{t}</button>
                ))}
              </div>
              <div className="mobile-menu-divider" />
              <div className="mobile-menu-section">
                <span className="mobile-menu-label ttt-label">Time Tracker</span>
                {TTT_TABS.map(t => (
                  <button key={t} className={`mobile-tab ttt-tab ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>{t}</button>
                ))}
              </div>
            </div>
          )}

        </div>
      </header>

      <main className="main">
        {tab === "Chat"         && <Chat          token={token} />}
        {tab === "Search"       && <Search        token={token} />}
        {tab === "Upload"       && <Upload        token={token} />}
        {tab === "Meeting"      && <MeetingUpload token={token} />}
        {tab === "Sources"      && <Sources       token={token} />}
        {tab === "Dashboard"    && <TTTDashboard  token={token} />}
        {tab === "Time Entries" && <TTTEntries    token={token} />}
        {tab === "Manual Entry" && <TTTManualEntry token={token} />}
        {tab === "Import"       && <TTTImport     token={token} />}
        {tab === "Reports"      && <TTTReports    token={token} />}
      </main>
    </div>
  );
}
