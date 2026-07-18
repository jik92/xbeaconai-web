import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { APP_CONFIG } from "./src/app/config";

export default defineConfig({
  plugins: [
    { name: "project-name", transformIndexHtml: (html) => html.replaceAll("%PROJECT_NAME%", APP_CONFIG.projectName) },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: {
      "/api": { target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787", changeOrigin: false },
      "/openapi.json": { target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
});
