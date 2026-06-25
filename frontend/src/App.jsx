import { useState } from "react";
import Upload from "./components/Upload";
import Search from "./components/Search";
import Sources from "./components/Sources";
import Chat from "./components/Chat";
import MeetingUpload from "./components/MeetingUpload";
import "./App.css";

const TABS = ["Chat", "Search", "Upload", "Meeting", "Sources"];

export default function App() {
  const [tab, setTab] = useState("Chat");

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <h1 className="logo">🗂 Knowledge<span>Base</span></h1>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t}
                className={`tab-btn ${tab === t ? "active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="main">
        {tab === "Chat"    && <Chat />}
        {tab === "Search"  && <Search />}
        {tab === "Upload"  && <Upload />}
        {tab === "Meeting" && <MeetingUpload />}
        {tab === "Sources" && <Sources />}
      </main>
    </div>
  );
}
