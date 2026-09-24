import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发模式：浏览器同源请求 /api/*，由 Vite 代理到 agentd（8787）。
// 生产模式：agentd 直接托管 dist/，无代理、无跨域。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
