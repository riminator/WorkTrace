import { createContext, useContext, useEffect, useState, useRef } from "react";

// ── Default task-type color palettes ─────────────────────────────────────────

export const DEFAULT_TASK_COLORS_LIGHT = {
  meeting:     { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  development: { bg: "#dcfce7", border: "#16a34a", text: "#14532d" },
  planning:    { bg: "#fef9c3", border: "#ca8a04", text: "#713f12" },
  review:      { bg: "#f3e8ff", border: "#9333ea", text: "#581c87" },
  admin:       { bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  learning:    { bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  other:       { bg: "#f1f5f9", border: "#64748b", text: "#334155" },
};

export const DEFAULT_TASK_COLORS_DARK = {
  meeting:     { bg: "#444791", border: "#6264a7", text: "#fff" },
  development: { bg: "#237b4b", border: "#33a869", text: "#fff" },
  planning:    { bg: "#8b6200", border: "#d19f00", text: "#fff" },
  review:      { bg: "#7719aa", border: "#a34bcc", text: "#fff" },
  admin:       { bg: "#b43f35", border: "#d4574c", text: "#fff" },
  learning:    { bg: "#c65000", border: "#e97b2e", text: "#fff" },
  other:       { bg: "#3d5266", border: "#6b8099", text: "#fff" },
};

export const TASK_TYPES = ["meeting", "development", "planning", "review", "admin", "learning", "other"];

// ── Default prefs ─────────────────────────────────────────────────────────────

const DEFAULT_PREFS = {
  accent:    "#6366f1",
  fontSize:  "14",
  headerBg:  "",        // empty = use theme default (#0f172a)
  chipColor: "",        // empty = use surface-2/border default
  taskColors: {},
};

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem("wt-prefs") || "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const ThemeContext = createContext({
  theme: "light",
  toggleTheme: () => {},
  prefs: DEFAULT_PREFS,
  setPrefs: () => {},
  getTaskColor: () => ({ bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" }),
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem("wt-theme") || "light");
  const [prefs, setPrefsState] = useState(loadPrefs);

  // Apply data-theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("wt-theme", theme);
  }, [theme]);

  // Apply font size — set both the CSS var AND body directly to ensure it takes effect
  useEffect(() => {
    const px = `${prefs.fontSize || 14}px`;
    document.documentElement.style.setProperty("--font-size", px);
    document.body.style.setProperty("font-size", px, "important");
  }, [prefs.fontSize]);

  // Apply accent color override as CSS variable
  useEffect(() => {
    if (prefs.accent && prefs.accent !== DEFAULT_PREFS.accent) {
      document.documentElement.style.setProperty("--accent", prefs.accent);
      // derive hover as slightly darker — just dim with brightness
      document.documentElement.style.setProperty("--accent-hover", prefs.accent);
      document.documentElement.style.setProperty("--border-focus", prefs.accent);
    } else {
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--accent-hover");
      document.documentElement.style.removeProperty("--border-focus");
    }
  }, [prefs.accent]);

  // Apply header background override
  useEffect(() => {
    if (prefs.headerBg) {
      document.documentElement.style.setProperty("--header-bg", prefs.headerBg);
      // auto-darken for border: add 20% black overlay via a slightly darker shade
      document.documentElement.style.setProperty("--header-border", prefs.headerBg + "cc");
    } else {
      document.documentElement.style.removeProperty("--header-bg");
      document.documentElement.style.removeProperty("--header-border");
    }
  }, [prefs.headerBg]);

  // Apply chip color override
  useEffect(() => {
    if (prefs.chipColor) {
      document.documentElement.style.setProperty("--chip-bg",     prefs.chipColor + "22");
      document.documentElement.style.setProperty("--chip-border",  prefs.chipColor);
      document.documentElement.style.setProperty("--chip-text",    prefs.chipColor);
    } else {
      document.documentElement.style.removeProperty("--chip-bg");
      document.documentElement.style.removeProperty("--chip-border");
      document.documentElement.style.removeProperty("--chip-text");
    }
  }, [prefs.chipColor]);

  function setPrefs(update) {
    setPrefsState(prev => {
      const next = typeof update === "function" ? update(prev) : { ...prev, ...update };
      localStorage.setItem("wt-prefs", JSON.stringify(next));
      return next;
    });
  }

  function toggleTheme() {
    setTheme(t => t === "light" ? "dark" : "light");
  }

  /**
   * Returns the full { bg, border, text } color object for a task type,
   * respecting any per-type override stored in prefs.taskColors.
   */
  function getTaskColor(type) {
    const defaults = theme === "dark" ? DEFAULT_TASK_COLORS_DARK : DEFAULT_TASK_COLORS_LIGHT;
    const base = defaults[type] || defaults.other;
    const overrideBorder = prefs.taskColors?.[type];
    if (!overrideBorder) return base;
    // User chose a custom border/accent colour — derive bg as very light tint
    return {
      border: overrideBorder,
      bg: theme === "dark" ? overrideBorder + "55" : overrideBorder + "22",
      text: theme === "dark" ? "#fff" : base.text,
    };
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, prefs, setPrefs, getTaskColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
