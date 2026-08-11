/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Surchargables par env : permet une 2e pile (tests) à côté de la pile de dev.
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // Le front tape /api → backend Fastify (§6.2).
      '/api': process.env.API_PROXY ?? 'http://localhost:8787',
    },
  },
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
