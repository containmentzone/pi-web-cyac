import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = `http://127.0.0.1:${process.env.PI_WEB_PORT ?? 8787}`;

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    proxy: {
      "/api": api,
      "/ws": { target: api, ws: true },
    },
  },
});
