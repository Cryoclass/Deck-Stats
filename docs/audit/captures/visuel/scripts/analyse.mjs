import fs from 'node:fs';
const M = JSON.parse(fs.readFileSync('C:/dev/Testhand/docs/audit/captures/visuel/mesures.json', 'utf8'));
const keys = Object.keys(M).sort();
console.log('PAGES MESURÉES', keys.length);
// 1. Échecs de contraste agrégés par (fg, bg, taille) sur les fonds OPAQUES (hors image)
const agg = new Map();
for (const k of keys) for (const c of M[k].contrast) {
  if (c.overImage || !c.opaque) continue;
  const id = `${c.fg}|${c.bg}|${c.size}|${c.weight >= 600 ? 'b' : 'n'}`;
  const cur = agg.get(id) || { fg: c.fg, bg: c.bg, size: c.size, weight: c.weight, ratio: c.ratio, pass: c.pass, n: 0, pages: new Set(), samples: new Set(), cls: c.cls };
  cur.n += c.n; cur.pages.add(k.replace(/-\d+$/, '')); if (cur.samples.size < 4) cur.samples.add(c.sample);
  agg.set(id, cur);
}
const rows = [...agg.values()].sort((a, b) => a.ratio - b.ratio);
console.log('\n=== PAIRES TEXTE/FOND OPAQUE — toutes (ratio, taille, occurrences, pages, exemples) ===');
for (const r of rows) console.log(`${r.pass ? 'OK ' : 'KO '} ${String(r.ratio).padEnd(5)} ${r.fg} sur ${r.bg} ${String(r.size).padStart(4)}px w${r.weight} n=${String(r.n).padStart(4)} pages=${r.pages.size} | ${[...r.samples].join(' / ').slice(0, 110)}`);
// 2. Sur image / fond translucide
console.log('\n=== TEXTES SUR IMAGE OU FOND TRANSLUCIDE (ratio = pire cas noir/blanc) ===');
const img = new Map();
for (const k of keys) for (const c of M[k].contrast) { if (!(c.overImage || !c.opaque)) continue; const id = `${c.fgRaw}|${c.size}|${c.sample.slice(0, 12)}`; const cur = img.get(id) || { ...c, pages: new Set() }; cur.pages.add(k); img.set(id, cur); }
for (const c of [...img.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 40)) console.log(`${c.pass ? 'OK ' : 'KO '} ${String(c.ratio).padEnd(5)} ${c.fg} sur ${c.bg} ${c.size}px | ${c.sample} | ${c.cls.slice(0, 60)} | ${[...c.pages].slice(0, 3).join(',')}`);
// 3. Cibles
console.log('\n=== CIBLES TACTILES < 24 px (par largeur) ===');
for (const w of ['360', '768', '1440']) {
  const seen = new Map();
  for (const k of keys.filter((k) => k.endsWith('-' + w))) for (const t of M[k].targets) { if (Math.min(t.w, t.h) >= 24) continue; const id = `${t.tag}|${t.label}|${t.w}x${t.h}`; const cur = seen.get(id) || { ...t, pages: new Set() }; cur.pages.add(k.replace(/-\d+$/, '')); seen.set(id, cur); }
  console.log(`-- ${w} px : ${seen.size} cibles distinctes sous 24 px`);
  for (const t of [...seen.values()].sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))) console.log(`   ${t.w}x${t.h} <${t.tag}> « ${t.label} » | ${t.cls.slice(0, 60)} | ${[...t.pages].slice(0, 4).join(',')}`);
}
console.log('\n=== CIBLES 24–31 px à 360 (sous la recommandation 32 px / WCAG 2.5.5 44 px) ===');
{ const seen = new Map();
  for (const k of keys.filter((k) => k.endsWith('-360'))) for (const t of M[k].targets) { const m = Math.min(t.w, t.h); if (m < 24 || m >= 32) continue; const id = `${t.tag}|${t.label}|${t.h}`; const cur = seen.get(id) || { ...t, pages: new Set() }; cur.pages.add(k.replace(/-\d+$/, '')); seen.set(id, cur); }
  console.log(seen.size, 'cibles distinctes');
  for (const t of [...seen.values()].sort((a, b) => a.h - b.h).slice(0, 60)) console.log(`   ${t.w}x${t.h} <${t.tag}> « ${t.label} » | ${[...t.pages].slice(0, 3).join(',')}`);
}
// 4. Tailles de police (éléments porteurs de texte dans le viewport)
console.log('\n=== TAILLES DE POLICE (éléments texte visibles, cumul par largeur) ===');
for (const w of ['360', '768', '1440']) { const f = {}; for (const k of keys.filter((k) => k.endsWith('-' + w))) for (const [s, n] of Object.entries(M[k].fonts)) f[s] = (f[s] || 0) + n; const tot = Object.values(f).reduce((a, b) => a + b, 0); console.log(w, Object.entries(f).sort((a, b) => +a[0] - +b[0]).map(([s, n]) => `${s}px:${n} (${Math.round(100 * n / tot)}%)`).join('  ')); }
// 5. Par page : nombre de textes, échecs, min ratio
console.log('\n=== PAR PAGE ===');
for (const k of keys) { const c = M[k].contrast.filter((x) => !x.overImage && x.opaque); const ko = c.filter((x) => !x.pass); console.log(`${k.padEnd(30)} textes=${String(c.length).padStart(3)} KO=${String(ko.length).padStart(3)} (${c.length ? Math.round(100 * ko.length / c.length) : 0}%) cibles=${M[k].targets.length} <24=${M[k].targets.filter((t) => Math.min(t.w, t.h) < 24).length} scrollW=${M[k].doc.scrollWidth}/${M[k].doc.innerWidth}`); }
