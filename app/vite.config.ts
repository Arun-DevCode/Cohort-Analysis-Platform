import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
              res.writeHead(503, {
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({
                status: 'error',
                message: 'Backend API is currently unavailable. Ensure the server is running on port 4000.',
              }));
            }
          });
        },
      },
    },
  },
  worker: {
    format: "es",
  },
  // @ts-expect-error vitest config
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
