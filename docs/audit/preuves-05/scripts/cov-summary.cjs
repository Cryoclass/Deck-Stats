// Résume coverage-summary.json (Vitest v8) par dossier et par fichier.
const s = require(process.argv[2]);
const rows = [];
for (const [f, v] of Object.entries(s)) {
  if (f === 'total') continue;
  const rel = f.split(String.fromCharCode(92)).join('/').split('/mirror/web/')[1];
  rows.push({ rel, l: v.lines.pct, b: v.branches.pct, fn: v.functions.pct, lt: v.lines.total, lc: v.lines.covered, bt: v.branches.total, bc: v.branches.covered });
}
rows.sort((a, b) => a.rel.localeCompare(b.rel));
const groups = {};
for (const r of rows) {
  const key = r.rel.startsWith('src/engine/reference') ? 'src/engine/reference' : r.rel.split('/').slice(0, 2).join('/');
  (groups[key] ??= []).push(r);
}
for (const [g, rs] of Object.entries(groups)) {
  let t = 0, c = 0, bt = 0, bc = 0;
  for (const r of rs) { t += r.lt; c += r.lc; bt += r.bt; bc += r.bc; }
  console.log(`\n## ${g}  lignes ${c}/${t} = ${(100 * c / Math.max(t, 1)).toFixed(1)} %  branches ${bc}/${bt} = ${(100 * bc / Math.max(bt, 1)).toFixed(1)} %`);
  for (const r of rs) console.log(`${r.rel.padEnd(44)} L ${String(r.l).padStart(6)}  B ${String(r.b).padStart(6)}  F ${String(r.fn).padStart(6)}  (${r.lc}/${r.lt})`);
}
console.log('\nTOTAL lignes', JSON.stringify(s.total.lines), 'branches', JSON.stringify(s.total.branches));
