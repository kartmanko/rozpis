/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // "Broadcast" paleta — schválený vizuál (navrh-final.html)
        f: {
          bg: "#101010",
          panel: "#171717",
          panel2: "#1d1d1d",
          panel3: "#141414",
          border: "#262626",
          border2: "#303030",
          hair: "#1c1c1c",
          text: "#fafafa",
          muted: "#a3a3a3",
          muted2: "#8a8a8a",
          faint: "#6e6e6e",
          faint2: "#4a4a4a",
          accent: "#ff4d17",
          a: "#3ee08a",
          b: "#5fa8ff",
          c: "#c58bff",
          r: "#ffb43a",
          duel: "#ff5fb0",
          reh: "#c084fc",
          fifthbg: "#161310",
          today: "#12241a",
        },
      },
    },
  },
  plugins: [],
};
