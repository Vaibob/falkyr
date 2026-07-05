import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite app lives in web/. Dev server proxies /api to the Fastify backend.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: the Fastify server binds IPv4 only, and
        // Node 17+ resolves localhost to ::1 first, which 502s the proxy.
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
