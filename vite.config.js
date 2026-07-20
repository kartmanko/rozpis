import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base cesta pre GitHub Pages: https://<user>.github.io/rozpis/
// Ak nasadzuješ inak (vlastná doména, iný repo názov), uprav base nižšie.
export default defineConfig({
  plugins: [react()],
  base: "/rozpis/",
});
