import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@office-kart/shared": path.resolve(here, "../../packages/shared/src/index.ts") },
  },
  server: { port: 5173, host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
