import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Uitgeleverd door de backend op hetzelfde adres. Geen inline scripts of
// stijlen: de CSP staat alleen 'self' toe.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  server: { proxy: { "/api": "http://localhost:4300" } },
});
