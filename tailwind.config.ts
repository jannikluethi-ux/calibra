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
          bg: "#101614",
          panel: "#161e1b",
          surface: "#1c2622",
          border: "#2e3c36",
          muted: "#7d8b84",
          text: "#e7eee9",
          dim: "#a8b5ae",
          accent: "#8fd0c4",
          green: "#3dcc9a",
          red: "#f07167",
          amber: "#e4b15c",
          cyan: "#7ec8bf",
          teal: "#3dbeab",
          purple: "#a3adc4",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        sans: ["var(--font-ui)", "Inter", "system-ui", "-apple-system", "sans-serif"],
        display: ["var(--font-display)", "Segoe UI", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(61, 190, 171, 0.18), 0 8px 24px rgba(0, 0, 0, 0.28)",
        "glow-amber": "0 0 0 1px rgba(228, 177, 92, 0.22)",
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
