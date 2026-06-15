/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand green (#00A221) + tints/shades.
        brand: {
          50: "#e6f7ea",
          100: "#c2ebcd",
          200: "#8fdca5",
          300: "#54c878",
          400: "#22b450",
          500: "#00A221",
          600: "#00911d",
          700: "#007a18",
          800: "#005f12",
          900: "#00440d",
        },
        // Charcoal grey for surfaces + text.
        charcoal: {
          50: "#f4f5f6",
          100: "#e4e6e8",
          200: "#c7ccd0",
          300: "#9aa3aa",
          400: "#6b757e",
          500: "#4a535b",
          600: "#363f47",
          700: "#2b333a",
          800: "#22282e",
          900: "#181d21",
        },
      },
    },
  },
  plugins: [],
};
