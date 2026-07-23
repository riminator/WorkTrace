import { useState, useRef, useEffect } from "react";
import Documents from "./components/Documents";
import Search from "./components/Search";
import Sources from "./components/Sources";
import Chat from "./components/Chat";
import LoginPage from "./components/LoginPage";
import TTTDashboard from "./components/TTTDashboard";
import TTTEntries from "./components/TTTEntries";
import TTTImport from "./components/TTTImport";
import TTTReports from "./components/TTTReports";
import FeedbackStats from "./components/FeedbackStats";
import AdminPanel from "./components/AdminPanel";
import { useSession, useAccessToken, useIsAdmin } from "./context/AuthContext";
import { supabase } from "./supabaseClient";
import "./App.css";

const KB_TABS  = ["Chat", "Search", "Documents", "Sources", "Feedback"];
const TTT_TABS = ["Dashboard", "Time Entries", "Import", "Reports"];

export default function App() {
  const session  = useSession();
  const token    = useAccessToken();
  const isAdmin  = useIsAdmin();

  // Default admins to the Admin tab; regular users to Dashboard
  const [tab, setTab]           = useState(null);  // null = "not yet decided"
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef                 = useRef(null);

  // Set initial tab once we know isAdmin (after /me resolves)
  useEffect(() => {
    if (tab === null && session) {
      setTab(isAdmin ? "Admin" : "Dashboard");
    }
  }, [isAdmin, session]);

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

  if (session === undefined || (session && tab === null)) return <div className="app-loading">Loading…</div>;
  if (!session) return <LoginPage />;

  const isTTT = TTT_TABS.includes(tab);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">

          {/* ── Row 1: logo + user bar ── */}
          <div className="header-row1">
            <h1 className="logo">Work<span>Trace</span></h1>

            <div className="user-bar">
              <span className="user-email">{session.user.email}</span>
              <button className="logout-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>

              {/* Hamburger — only visible below 520px */}
              <button className="hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
                <span /><span /><span />
              </button>
            </div>
          </div>

          {/* ── Row 2: nav tabs — wraps to new line when narrow ── */}
          <div className="header-row2">
            <nav className="nav-desktop">
              {isAdmin && (
                <>
                  <div className="nav-group">
                    <button className={`tab-btn admin-tab ${tab === "Admin" ? "active" : ""}`} onClick={() => switchTab("Admin")}>
                      ⚙ Admin
                    </button>
                  </div>
                  <div className="nav-divider" />
                </>
              )}
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
          </div>

          {/* Mobile dropdown — only appears below 520px */}
          {menuOpen && (
            <div className="mobile-menu" ref={menuRef}>
              {isAdmin && (
                <>
                  <div className="mobile-menu-section">
                    <button className={`mobile-tab admin-tab ${tab === "Admin" ? "active" : ""}`} onClick={() => switchTab("Admin")}>⚙ Admin</button>
                  </div>
                  <div className="mobile-menu-divider" />
                </>
              )}
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
        {tab === "Admin"        && <AdminPanel   token={token} />}
        {tab === "Chat"         && <Chat         token={token} />}
        {tab === "Search"       && <Search       token={token} />}
        {tab === "Documents"    && <Documents    token={token} />}
        {tab === "Sources"      && <Sources      token={token} />}
        {tab === "Feedback"     && <FeedbackStats token={token} />}
        {tab === "Dashboard"    && <TTTDashboard token={token} />}
        {tab === "Time Entries" && <TTTEntries   token={token} />}
        {tab === "Import"       && <TTTImport    token={token} />}
        {tab === "Reports"      && <TTTReports   token={token} />}
      </main>
    </div>
  );
}
