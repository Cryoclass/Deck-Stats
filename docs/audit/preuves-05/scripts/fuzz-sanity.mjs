// Contrôle du pouvoir de détection du test différentiel : chaque mutant survivant ou témoin est
// appliqué à la copie, le test aléatoire est rejoué (300 decks), le fichier est restauré (hash vérifié).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, 'mirror', 'web');
const ids = process.argv.slice(2);
const sha = (s) => createHash('sha256').update(s).digest('hex');
for (const id of ids) {
  const m = MUTANTS.find((x) => x.id === id);
  const file = path.join(web, m.file);
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace(m.from, () => m.to));
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'audit05-fuzz-builder.ts', '20260915', '300', '3'], { cwd: web, encoding: 'utf8', timeout: 600_000 });
  writeFileSync(file, original);
  if (sha(readFileSync(file, 'utf8')) !== sha(original)) throw new Error('restauration impossible');
  let summary;
  try { const j = JSON.parse(r.stdout); summary = `divergences=${j.divergences} / ${j.verifications} ; première : ${(j.premieres[0] ?? '').slice(0, 110)}`; } catch { summary = `sortie non JSON (exception) : ${(r.stderr || r.stdout).split('\n').find((l) => /Error/.test(l)) ?? ''}`; }
  console.log(`${id.padEnd(4)} ${m.why} → ${summary}`);
}
