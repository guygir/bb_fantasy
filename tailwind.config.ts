import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        exact: "#6aaa64",
        high: "#f5793a",
        low: "#85c0f9",
        "card-bg": "#f6f7f8",
        "bb-border": "#d3d6da",
        "bb-text": "#1a1a1b",
        "bb-gold": "#D4AF37",
      },
    },
  },
  plugins: [],
} satisfies Config;
