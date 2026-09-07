#!/usr/bin/env node
// Lance les tests en n'affichant que les échecs et le résumé final.
//   node scripts/test-quiet.mjs                       → web (Vitest) + server (node:test unitaires)
//   node scripts/test-quiet.mjs web/src/engine/x.test.ts server/tests/y.test.ts
//                                                     → uniquement ces fichiers
// Code de sortie : 0 si tout passe, 1 sinon, 2 si un argument est invalide.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const SUMMARY = /^\s*(Test Files|Tests|Duration)\b|^\s*ℹ (tests|pass|fail|cancelled|skipped|todo)\b/;
const NOISE = /^\s*(✓|✔)\s|^\s*RUN\s+v\d|^\s*ℹ (suites|duration_ms)\b/;

function run(label, cmd, args, cwd, shell = false) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', shell });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(ANSI, '');
  const lines = out.split(/\r?\n/);
  if (r.status === 0) {
    console.log(`✔ ${label}`);
    for (const l of lines.filter((l) => SUMMARY.test(l))) console.log(`  ${l.trim()}`);
    return true;
  }
  console.log(`✖ ${label} (code ${r.status ?? r.signal ?? '?'})`);
  console.log(lines.filter((l) => !NOISE.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim());
  return false;
}

const web = [];
const server = [];
for (const arg of process.argv.slice(2)) {
  const rel = path.relative(root, path.resolve(root, arg)).split(path.sep).join('/');
  if (rel.startsWith('web/')) web.push(rel.slice('web/'.length));
  else if (rel.startsWith('server/')) server.push(rel.slice('server/'.length));
  else { console.error(`Fichier hors web/ ou server/ : ${arg}`); process.exit(2); }
}
const all = web.length === 0 && server.length === 0;
if (all) server.push(...readdirSync(path.join(root, 'server/tests')).filter((f) => f.endsWith('.test.ts')).map((f) => `tests/${f}`));

let ok = true;
if (all || web.length) {
  const vitest = ['node_modules/vitest/vitest.mjs', 'web/node_modules/vitest/vitest.mjs'].map((p) => path.join(root, p)).find(existsSync);
  const label = `web · vitest${web.length ? ` · ${web.join(' ')}` : ''}`;
  ok = (vitest
    ? run(label, process.execPath, [vitest, 'run', ...web], path.join(root, 'web'))
    : run(label, 'npx', ['vitest', 'run', ...web], path.join(root, 'web'), true)) && ok;
}
if (server.length) {
  const label = `server · node:test · ${server.join(' ')}`;
  ok = run(label, process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...server], path.join(root, 'server')) && ok;
}
process.exit(ok ? 0 : 1);
