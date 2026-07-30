import { useState, useRef, useEffect } from "react";
import { useTheme, TASK_TYPES, DEFAULT_TASK_COLORS_LIGHT, DEFAULT_TASK_COLORS_DARK } from "../context/ThemeContext";

const ACCENT_PRESETS = [
  { label: "Indigo",  value: "#6366f1" },
  { label: "Blue",    value: "#3b82f6" },
  { label: "Violet",  value: "#8b5cf6" },
  { label: "Sky",     value: "#0ea5e9" },
  { label: "Green",   value: "#10b981" },
  { label: "Rose",    value: "#f43f5e" },
  { label: "Orange",  value: "#f97316" },
  { label: "Amber",   value: "#f59e0b" },
];

const FONT_SIZES = [
  { label: "Small",   value: "13" },
  { label: "Default", value: "14" },
  { label: "Large",   value: "15" },
];

// Friendly label for each task type
const TYPE_LABELS = {
  meeting:     "Meeting",
  development: "Development",
  planning:    "Planning",
  review:      "Review",
  admin:       "Admin",
  learning:    "Learning",
  other:       "Other",
};

export default function CustomizePanel() {
  const [open, setOpen]     = useState(false);
  const panelRef            = useRef(null);
  const btnRef              = useRef(null);
  const { theme, toggleTheme, prefs, setPrefs, getTaskColor } = useTheme();

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (open && panelRef.current && !panelRef.current.contains(e.target) && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function resetAll() {
    setPrefs({ accent: "#6366f1", fontSize: "14", taskColors: {} });
  }

  const defaults = theme === "dark" ? DEFAULT_TASK_COLORS_DARK : DEFAULT_TASK_COLORS_LIGHT;

  return (
    <div style={{ position: "relative" }}>
      {/* Trigger button */}
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        title="Customize appearance"
        style={{
          background: open ? "rgba(99,102,241,0.18)" : "none",
          border: "1px solid #334155",
          color: open ? "#a5b4fc" : "#64748b",
          padding: "3px 8px",
          borderRadius: 5,
          fontSize: 13,
          cursor: "pointer",
          lineHeight: 1,
          transition: "all 0.12s",
        }}
        onMouseEnter={e => { if (!open) { e.currentTarget.style.borderColor = "#64748b"; e.currentTarget.style.color = "#e2e8f0"; }}}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}}
      >
        ✦
      </button>

      {/* Popover panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: 56,
            right: 12,
            width: 300,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            zIndex: 500,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 14px", borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Appearance</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={resetAll} style={{ fontSize: 11, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                Reset
              </button>
              <button onClick={() => setOpen(false)} style={{ fontSize: 16, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
          </div>

          <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 18, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>

            {/* ── Theme ── */}
            <Section label="Theme">
              <div style={{ display: "flex", gap: 6 }}>
                {["light", "dark"].map(t => (
                  <button
                    key={t}
                    onClick={() => theme !== t && toggleTheme()}
                    style={{
                      flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", transition: "all 0.12s",
                      background: theme === t ? "var(--accent)" : "var(--surface-2)",
                      color: theme === t ? "#fff" : "var(--text-2)",
                      border: theme === t ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                    }}
                  >
                    {t === "light" ? "☀ Light" : "☾ Dark"}
                  </button>
                ))}
              </div>
            </Section>

            {/* ── Accent colour ── */}
            <Section label="Accent color">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ACCENT_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPrefs({ accent: p.value })}
                    title={p.label}
                    style={{
                      width: 26, height: 26, borderRadius: "50%", background: p.value,
                      border: prefs.accent === p.value ? "2.5px solid var(--text)" : "2.5px solid transparent",
                      cursor: "pointer", padding: 0, flexShrink: 0,
                      boxShadow: prefs.accent === p.value ? "0 0 0 2px var(--bg)" : "none",
                      outline: "none",
                    }}
                  />
                ))}
                {/* Custom colour picker */}
                <label title="Custom color" style={{ position: "relative", width: 26, height: 26, borderRadius: "50%", overflow: "hidden", cursor: "pointer", border: "2px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--muted)", flexShrink: 0 }}>
                  +
                  <input type="color" value={prefs.accent} onChange={e => setPrefs({ accent: e.target.value })}
                    style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
                </label>
              </div>
            </Section>

            {/* ── Font size ── */}
            <Section label="Font size">
              <div style={{ display: "flex", gap: 6 }}>
                {FONT_SIZES.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setPrefs({ fontSize: f.value })}
                    style={{
                      flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 12, fontWeight: 500,
                      cursor: "pointer", transition: "all 0.12s",
                      background: prefs.fontSize === f.value ? "var(--accent)" : "var(--surface-2)",
                      color: prefs.fontSize === f.value ? "#fff" : "var(--text-2)",
                      border: prefs.fontSize === f.value ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </Section>

            {/* ── Event / task colors ── */}
            <Section label="Event colors">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {TASK_TYPES.map(type => {
                  const current = getTaskColor(type);
                  const isCustom = !!prefs.taskColors?.[type];
                  return (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Color swatch / picker */}
                      <label style={{ position: "relative", width: 20, height: 20, borderRadius: 4, background: current.bg, border: `2px solid ${current.border}`, cursor: "pointer", flexShrink: 0, overflow: "hidden" }}>
                        <input
                          type="color"
                          value={prefs.taskColors?.[type] || defaults[type]?.border || "#6366f1"}
                          onChange={e => setPrefs(p => ({ ...p, taskColors: { ...p.taskColors, [type]: e.target.value } }))}
                          style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                        />
                      </label>
                      {/* Label */}
                      <span style={{ fontSize: 12, color: "var(--text)", flex: 1 }}>{TYPE_LABELS[type]}</span>
                      {/* Preview pill */}
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
                        background: current.bg, color: current.text, border: `1px solid ${current.border}`,
                        textTransform: "uppercase", letterSpacing: "0.4px",
                      }}>{type}</span>
                      {/* Reset button */}
                      {isCustom && (
                        <button
                          onClick={() => setPrefs(p => {
                            const tc = { ...p.taskColors };
                            delete tc[type];
                            return { ...p, taskColors: tc };
                          })}
                          title="Reset to default"
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)", padding: 0, lineHeight: 1 }}
                        >↺</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>

          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
