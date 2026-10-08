import { useState } from "react";
import { applyTheme, savedTheme } from "../lib/theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || savedTheme(),
  );
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="btn ghost theme-toggle"
      aria-pressed={dark}
      title={dark ? "Activar modo claro" : "Activar modo oscuro"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        applyTheme(next);
        setTheme(next);
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        ) : (
          <path d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" />
        )}
      </svg>
      {dark ? "Modo claro" : "Modo oscuro"}
    </button>
  );
}
