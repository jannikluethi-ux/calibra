import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: "#0e1412",
          panel: "#141c19",
          surface: "#1a2420",
          border: "#26332e",
          muted: "#83918a",
          text: "#e9f0eb",
          dim: "#b0bdb6",
          accent: "#8fd0c4",
          green: "#3dcc9a",
          red: "#f07167",
          amber: "#e4b15c",
          cyan: "#7ec8bf",
          teal: "#3dbeab",
          purple: "#a3adc4",
        },
        surface: { 0: "#0e1412", 1: "#141c19", 2: "#1a2420" },
        line: { DEFAULT: "#26332e", strong: "#34443d" },
        ink: { DEFAULT: "#e9f0eb", 2: "#b0bdb6", 3: "#83918a" },
        accent: { DEFAULT: "#3dbeab" },
        epi: { observed: "#a8c7fa", interpreted: "#c3b5f0", model: "#e4b15c", estimate: "#8fd0c4" },
        scenario: { base: "#8fa39a", upside: "#3dcc9a", downside: "#d9746b", tail: "#b07ce0" },
        dq: { fresh: "#3dcc9a", stale: "#e4b15c", insufficient: "#8fa39a" },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        sans: ["var(--font-ui)", "Inter", "system-ui", "-apple-system", "sans-serif"],
        display: ["var(--font-display)", "Segoe UI", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em" }],
        caption: ["0.75rem", { lineHeight: "1rem" }],
        body: ["0.875rem", { lineHeight: "1.375rem" }],
        "body-l": ["1rem", { lineHeight: "1.625rem" }],
        title: ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600" }],
        "display-l": ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.02em", fontWeight: "600" }],
        "display-xl": ["clamp(2rem, 4.5vw, 3rem)", { lineHeight: "1.08", letterSpacing: "-0.02em", fontWeight: "600" }],
        metric: ["1.5rem", { lineHeight: "1.75rem", fontWeight: "600" }],
        "metric-xl": ["2.5rem", { lineHeight: "2.75rem", fontWeight: "600" }],
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
        chip: "6px",
        card: "10px",
        hero: "14px",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(61, 190, 171, 0.18), 0 8px 24px rgba(0, 0, 0, 0.28)",
        "glow-amber": "0 0 0 1px rgba(228, 177, 92, 0.22)",
        e2: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.28)",
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 28px rgba(0,0,0,0.28)",
      },
      backgroundImage: {
        "hero-glow":
          "radial-gradient(ellipse 80% 70% at 0% 0%, rgba(61,190,171,0.10), transparent 55%), radial-gradient(ellipse 50% 60% at 100% 0%, rgba(228,177,92,0.06), transparent 50%)",
      },
    },
  },
  plugins: [],
};
export default config;
