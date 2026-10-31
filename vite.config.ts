/// <reference types="vitest/config" />
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// BoardGameGeek XML API2 has no CORS headers; proxy it in dev and `vite preview`.
// BGG's XML API requires a registered application token (Bearer): set BGG_TOKEN.
const bggProxy: Record<string, ProxyOptions> = {
  '/api/bgg': {
    target: 'https://boardgamegeek.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/bgg/, '/xmlapi2'),
    headers: process.env.BGG_TOKEN ? { Authorization: `Bearer ${process.env.BGG_TOKEN}` } : undefined,
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // manifold-3d ships a WASM module that must not be pre-bundled.
    exclude: ['manifold-3d'],
  },
  server: { proxy: bggProxy },
  preview: { proxy: bggProxy },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
