/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000';
  return {
    plugins: [react()],
    // Dev-only proxy so `npm run dev` works without CORS when VITE_API_BASE_URL is empty.
    server: { proxy: { '/api': backendTarget, '/health': backendTarget } },
    build: { chunkSizeWarningLimit: 1500 },
    test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
  };
});
