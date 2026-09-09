/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Étape 9 (Q1) : version du moteur = empreinte du contenu des sources qui déterminent un
// résultat (moteur pur, construction du modèle, conditions, définition du résumé).
// Injectée au build comme `__ENGINE_VERSION__` ; un résumé d'aperçu stocké avec une autre
// version n'est jamais affiché tel quel (lib/summary.ts). Tout changement de ces fichiers,
// même un commentaire, invalide donc les aperçus : accepté, le recalcul coûte ~1–2 s.
function engineVersion(): string {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src');
  const engineDir = path.join(src, 'engine');
  const files = readdirSync(engineDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(engineDir, f));
  files.push(path.join(src, 'lib', 'engineModel.ts'), path.join(src, 'lib', 'conditions.ts'), path.join(src, 'lib', 'summary.ts'));
  const h = createHash('sha1');
  for (const f of files.sort()) {
    h.update(path.basename(f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export default defineConfig({
  plugins: [react()],
  define: { __ENGINE_VERSION__: JSON.stringify(engineVersion()) },
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
