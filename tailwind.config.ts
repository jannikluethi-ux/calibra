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
          bg: "#070b14",
          panel: "#0a101c",
          surface: "#0f1624",
          border: "#1a2436",
          muted: "#64748b",
          text: "#e8eef7",
          dim: "#94a3b8",
          accent: "#38bdf8",
          green: "#34d399",
          red: "#f87171",
          amber: "#fbbf24",
          cyan: "#22d3ee",
          teal: "#2dd4bf",
          purple: "#a78bfa",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        sans: ["var(--font-ui)", "Inter", "system-ui", "-apple-system", "sans-serif"],
        display: ["var(--font-display)", "Segoe UI", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "0.9rem" }],
      },
      boxShadow: {
        glow: "0 0 24px rgba(45, 212, 191, 0.12)",
        "glow-amber": "0 0 20px rgba(251, 191, 36, 0.1)",
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)",
      },
      backgroundImage: {
        "hero-glow":
          "radial-gradient(ellipse 80% 60% at 20% 0%, rgba(45,212,191,0.12), transparent 55%), radial-gradient(ellipse 60% 50% at 90% 10%, rgba(56,189,248,0.08), transparent 50%)",
      },
    },
  },
  plugins: [],
};
export default config;
