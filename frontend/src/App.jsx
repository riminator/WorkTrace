import { useState, useRef, useEffect } from "react";
import Documents from "./components/Documents";
import Search from "./components/Search";
import Sources from "./components/Sources";
import Chat from "./components/Chat";
import LoginPage from "./components/LoginPage";
import TTTDashboard from "./components/TTTDashboard";
import TTTEntries from "./components/TTTEntries";
import TTTReports from "./components/TTTReports";
import FeedbackStats from "./components/FeedbackStats";
import AdminPanel from "./components/AdminPanel";
import HowToUse from "./components/HowToUse";
import CalendarView from "./components/CalendarView";
import { useSession, useAccessToken, useIsAdmin } from "./context/AuthContext";
import { supabase } from "./supabaseClient";
import "./App.css";

const ALL_TABS = ["Dashboard", "Time Entries", "Reports", "Calendar", "Import", "Chat", "Search", "Sources", "Feedback", "How to Use"];

export default function App() {
  const session  = useSession();
  const token    = useAccessToken();
  const isAdmin  = useIsAdmin();

  const [tab, setTab]           = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef                 = useRef(null);

  useEffect(() => {
    if (tab === null && session) {
      setTab(isAdmin ? "Admin" : "Dashboard");
    }
  }, [isAdmin, session]);

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

          {/* ── Row 2: flat nav ── */}
          <div className="header-row2">
            <nav className="nav-desktop">
              {isAdmin && (
                <button className={`tab-btn admin-tab ${tab === "Admin" ? "active" : ""}`} onClick={() => switchTab("Admin")}>
                  ⚙ Admin
                </button>
              )}
              {ALL_TABS.map(t => (
                <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>{t}</button>
              ))}
            </nav>
          </div>

          {/* Mobile dropdown */}
          {menuOpen && (
            <div className="mobile-menu" ref={menuRef}>
              <div className="mobile-menu-section">
                {isAdmin && (
                  <button className={`mobile-tab admin-tab ${tab === "Admin" ? "active" : ""}`} onClick={() => switchTab("Admin")}>⚙ Admin</button>
                )}
                {ALL_TABS.map(t => (
                  <button key={t} className={`mobile-tab ${tab === t ? "active" : ""}`} onClick={() => switchTab(t)}>{t}</button>
                ))}
              </div>
            </div>
          )}

        </div>
      </header>

      <main className="main">
        {tab === "Admin"        && <AdminPanel    token={token} />}
        {tab === "Chat"         && <Chat          token={token} />}
        {tab === "Search"       && <Search        token={token} />}
        {tab === "Import"       && <Documents     token={token} />}
        {tab === "Sources"      && <Sources       token={token} />}
        {tab === "Feedback"     && <FeedbackStats token={token} />}
        {tab === "Dashboard"    && <TTTDashboard  token={token} />}
        {tab === "Time Entries" && <TTTEntries    token={token} />}
        {tab === "Reports"      && <TTTReports    token={token} />}
        {tab === "Calendar"     && <CalendarView   token={token} />}
        {tab === "How to Use"   && <HowToUse />}
      </main>
    </div>
  );
}
