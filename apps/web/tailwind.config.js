/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Mockup-aligned SEnuke blue.
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
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
