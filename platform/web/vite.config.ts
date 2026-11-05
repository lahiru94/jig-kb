import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/ws": { target: "ws://localhost:4300", ws: true } } },
  build: { outDir: "dist", emptyOutDir: true },
});
