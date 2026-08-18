/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        display: ["Oswald", "sans-serif"]
      },
      colors: {
        lol: {
          gold: "#C8AA6E",
          goldLight: "#F0E6D2",
          goldDark: "#7A5C29",
          blue: "#0AC8B9",
          darkBg: "#050914",
          cardBg: "#0A1428",
          border: "#1E2A44"
        }
      },
      backgroundImage: {
        "hero-pattern":
          "radial-gradient(ellipse at top, rgba(10, 20, 40, 1) 0%, rgba(5, 9, 20, 1) 100%)"
      }
    }
  },
  plugins: []
};
