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
        // "Broadcast" paleta — schválený vizuál (navrh-final.html), farby cez CSS premenné
        // (pozri src/index.css), aby fungoval prepínač tmavý/svetlý/auto bez zmeny tried v komponentoch.
        f: {
          bg: "rgb(var(--f-bg) / <alpha-value>)",
          panel: "rgb(var(--f-panel) / <alpha-value>)",
          panel2: "rgb(var(--f-panel2) / <alpha-value>)",
          panel3: "rgb(var(--f-panel3) / <alpha-value>)",
          border: "rgb(var(--f-border) / <alpha-value>)",
          border2: "rgb(var(--f-border2) / <alpha-value>)",
          hair: "rgb(var(--f-hair) / <alpha-value>)",
          text: "rgb(var(--f-text) / <alpha-value>)",
          muted: "rgb(var(--f-muted) / <alpha-value>)",
          muted2: "rgb(var(--f-muted2) / <alpha-value>)",
          faint: "rgb(var(--f-faint) / <alpha-value>)",
          faint2: "rgb(var(--f-faint2) / <alpha-value>)",
          accent: "rgb(var(--f-accent) / <alpha-value>)",
          a: "rgb(var(--f-a) / <alpha-value>)",
          b: "rgb(var(--f-b) / <alpha-value>)",
          c: "rgb(var(--f-c) / <alpha-value>)",
          r: "rgb(var(--f-r) / <alpha-value>)",
          duel: "rgb(var(--f-duel) / <alpha-value>)",
          reh: "rgb(var(--f-reh) / <alpha-value>)",
          fifthbg: "rgb(var(--f-fifthbg) / <alpha-value>)",
          today: "rgb(var(--f-today) / <alpha-value>)",
          // pevná tmavá farba textu na farebných odznakoch (smeny, Duel, ✓) — nemení sa
          // podľa témy, lebo odznaky majú vždy sýte/svetlé pozadie v oboch témach.
          ink: "#101010",
        },
      },
    },
  },
  plugins: [],
};
