// Campagne de mutations sur la copie scratchpad/audit05/mirror/web. Jamais sur le dépôt.
// Pour chaque mutant : remplacement exact (1 occurrence exigée), suite Vitest complète avec
// --bail=1, lecture du rapport JSON, restauration du fichier d'origine, vérification par hash.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, 'mirror', 'web');
const vitest = path.join(here, 'mirror', 'node_modules', 'vitest', 'vitest.mjs');
const out = path.join(here, 'mutants-results.jsonl');
const only = process.argv.slice(2);
const sha = (s) => createHash('sha256').update(s).digest('hex');

for (const m of MUTANTS) {
  if (only.length && !only.includes(m.id)) continue;
  const file = path.join(web, m.file);
  const original = readFileSync(file, 'utf8');
  const originalHash = sha(original);
  const count = original.split(m.from).length - 1;
  if (count !== 1) {
    const rec = { id: m.id, file: m.file, status: 'invalid', detail: `occurrences=${count}` };
    appendFileSync(out, JSON.stringify(rec) + '\n');
    console.log(rec);
    continue;
  }
  const line = original.slice(0, original.indexOf(m.from)).split('\n').length;
  writeFileSync(file, original.replace(m.from, () => m.to));
  const report = path.join(here, `mut-${m.id}.json`);
  if (existsSync(report)) rmSync(report);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [vitest, 'run', '--bail=1', '--reporter=json', `--outputFile=${report}`], { cwd: web, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 600_000 });
  const ms = Date.now() - t0;
  writeFileSync(file, original);
  if (sha(readFileSync(file, 'utf8')) !== originalHash) throw new Error(`restauration impossible : ${m.file}`);
  let failed = [];
  let totals = null;
  if (existsSync(report)) {
    const j = JSON.parse(readFileSync(report, 'utf8'));
    totals = { tests: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests };
    for (const f of j.testResults) for (const a of f.assertionResults) if (a.status === 'failed') failed.push(`${path.basename(f.name)} › ${a.fullName}`);
    // Erreur de chargement d'un fichier de test (compilation, exception au import) :
    for (const f of j.testResults) if (f.status === 'failed' && f.assertionResults.every((a) => a.status !== 'failed')) failed.push(`${path.basename(f.name)} › (échec du fichier) ${String(f.message).slice(0, 160)}`);
  }
  const status = r.status === 0 ? 'SURVIVANT' : 'tué';
  const rec = { id: m.id, file: m.file, line, why: m.why, status, exit: r.status, ms, totals, killedBy: failed.slice(0, 3) };
  appendFileSync(out, JSON.stringify(rec) + '\n');
  console.log(`${m.id.padEnd(4)} ${status.padEnd(9)} ${String(ms).padStart(6)} ms  ${m.file}:${line}  ${failed[0] ?? ''}`);
}
