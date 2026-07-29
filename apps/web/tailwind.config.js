/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderColor: {
        DEFAULT: "#d6f8f8",
      },
      colors: {
        // SENuke logo spectrum. These shared tokens keep the complete product
        // aligned with the green → cyan → blue mark.
        brand: {
          50: "#effcfd",
          100: "#d6f8f8",
          200: "#acf0f1",
          300: "#72e2e6",
          400: "#2dced7",
          500: "#13b7c5",
          600: "#0899b1",
          700: "#087a99",
          800: "#0b627b",
          900: "#0d5167",
          950: "#082f3f",
        },
        senuke: {
          green: "#2bdc8b",
          cyan: "#12bfc9",
          blue: "#177fd3",
          navy: "#101820",
        },
        // Existing indigo/violet/teal utility classes are intentionally mapped
        // into the SENuke spectrum so older screens inherit the new brand
        // without one-off page overrides.
        indigo: {
          50: "#eff8ff",
          100: "#d9efff",
          200: "#bce3ff",
          300: "#8ed2ff",
          400: "#55b8fb",
          500: "#259ce9",
          600: "#177fd3",
          700: "#1767ad",
          800: "#17578e",
          900: "#174a75",
          950: "#0d2f4d",
        },
        violet: {
          50: "#effbff",
          100: "#d8f4ff",
          200: "#b9eaff",
          300: "#7edcff",
          400: "#39c9f0",
          500: "#14add8",
          600: "#088cb9",
          700: "#0b7095",
          800: "#0e5c79",
          900: "#104d65",
          950: "#092f40",
        },
        teal: {
          50: "#effcfd",
          100: "#d6f8f8",
          200: "#acf0f1",
          300: "#72e2e6",
          400: "#2dced7",
          500: "#13b7c5",
          600: "#0899b1",
          700: "#087a99",
          800: "#0b627b",
          900: "#0d5167",
          950: "#082f3f",
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
