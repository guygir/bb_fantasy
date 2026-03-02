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
        feature: "#8b5cf6",
        // Home page palette – pastel (from image)
        "btn-peach": "#F6DBCD",
        "btn-cream": "#F1E2BB",
        "btn-mint": "#E2EED4",
        "btn-sky-pastel": "#A3C0ED",
        "btn-lavender": "#C8CBE6",
        "btn-gray-pastel": "#E5E7EB",
        "btn-teal-pastel": "#B2DFDB",
      },
    },
  },
  plugins: [],
} satisfies Config;
