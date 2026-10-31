/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // manifold-3d ships a WASM module that must not be pre-bundled.
    exclude: ['manifold-3d'],
  },
  server: {
    proxy: {
      // BoardGameGeek XML API2 has no CORS headers; proxy it in dev.
      '/api/bgg': {
        target: 'https://boardgamegeek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bgg/, '/xmlapi2'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
