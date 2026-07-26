import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Appka beží na vlastnej doméne https://farma.kartmanko.cc — GitHub Pages
// s vlastnou doménou servuje repozitár priamo z koreňa, preto base = "/".
// Pôvodná adresa kartmanko.github.io/rozpis sa na novú doménu presmeruje sama.
export default defineConfig({
  plugins: [react()],
  base: "/",
});
