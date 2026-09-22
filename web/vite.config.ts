import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev/build：浏览器同源 /api/* 打到 Vite，Vite 转发到 bridge（3001），bridge 内部连 goose 的 ACP WS
// 这样浏览器到 Vite 是同源 HTTP/SSE（预览代理最稳的部分），WS 只在 bridge↔goose 之间（容器内直连）
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: [".monkeycode-ai.online"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
