/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Project-page teal is the shared product action palette.
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
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
