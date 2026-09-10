import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        elevated: "var(--bg-elevated)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        ink: "var(--text)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        chat: "var(--chat)",
        audio: "var(--audio)",
        both: "var(--both)",
        danger: "var(--danger)",
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 30px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
