import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../models", import.meta.url)),
      ],
    },
    proxy: {
      "/api": {
        target: process.env.METRO_API_URL ?? "http://127.0.0.1:8000",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
