import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.AGENCY_API ?? 'http://localhost:4317';

/** SSE-friendly proxy: no buffering, no caching, long-lived connections. */
const apiProxy: ProxyOptions = {
  target: API_TARGET,
  changeOrigin: true,
  ws: false,
  configure: (proxy) => {
    proxy.on('proxyRes', (res) => {
      const type = String(res.headers['content-type'] ?? '');
      if (type.includes('text/event-stream')) {
        res.headers['cache-control'] = 'no-cache, no-transform';
        res.headers['x-accel-buffering'] = 'no';
        delete res.headers['content-length'];
      }
    });
  },
};

const filesProxy: ProxyOptions = { target: API_TARGET, changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // ../shared/types.ts lives outside web/
    fs: { allow: ['..'] },
    proxy: { '/api': apiProxy, '/runs': filesProxy },
  },
  preview: {
    port: 4173,
    proxy: { '/api': apiProxy, '/runs': filesProxy },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
});
