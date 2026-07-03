import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // cores via CSS vars - permite tema dinamico controlado pelo ThemeProvider
      colors: {
        bg:        "rgb(var(--bg) / <alpha-value>)",
        surface:   "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        fg:        "rgb(var(--fg) / <alpha-value>)",
        muted:     "rgb(var(--muted) / <alpha-value>)",
        "text-3":  "rgb(var(--text-3) / <alpha-value>)",
        line:      "rgb(var(--line) / <alpha-value>)",
        "line-strong": "rgb(var(--border-strong) / <alpha-value>)",
        brand:     "rgb(var(--brand) / <alpha-value>)",
        "brand-2": "rgb(var(--brand-2) / <alpha-value>)",
        success:   "rgb(var(--success) / <alpha-value>)",
        warn:      "rgb(var(--warn) / <alpha-value>)",
        danger:    "rgb(var(--danger) / <alpha-value>)",
      },
      backgroundImage: {
        // gradiente principal: muda conforme o tema (CSS vars)
        "app-gradient": "var(--app-gradient)",
        "grad-brand": "var(--grad-brand)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      ringColor: {
        brand: "rgb(var(--ring) / <alpha-value>)",
      },
      fontFamily: {
        // Plus Jakarta Sans injetada via next/font (variável --font-sans no layout).
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
