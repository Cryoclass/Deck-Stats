// Liste les lignes et branches non couvertes pour les fichiers demandés (coverage-final.json, istanbul).
const fs = require('fs');
const [json, ...filters] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(json, 'utf8'));
for (const [file, cov] of Object.entries(data)) {
  const rel = file.split(String.fromCharCode(92)).join('/').split('/mirror/web/')[1];
  if (!filters.some((f) => rel === f)) continue;
  const src = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const lines = new Set();
  for (const [id, n] of Object.entries(cov.s)) if (n === 0) {
    const loc = cov.statementMap[id];
    for (let l = loc.start.line; l <= loc.end.line; l++) lines.add(l);
  }
  console.log(`\n=== ${rel} — lignes non exécutées : ${[...lines].sort((a, b) => a - b).join(', ') || 'aucune'}`);
  for (const l of [...lines].sort((a, b) => a - b)) console.log(`  L${l}: ${src[l - 1].trim().slice(0, 150)}`);
  for (const [id, counts] of Object.entries(cov.b)) {
    const b = cov.branchMap[id];
    counts.forEach((n, i) => {
      if (n !== 0) return;
      const loc = b.locations[i] ?? b.loc;
      const line = loc.start.line ?? b.loc.start.line;
      console.log(`  branche ${b.type} #${i} jamais prise L${line}: ${(src[line - 1] ?? '').trim().slice(0, 150)}`);
    });
  }
}
