// Comparaison avant / après sur les mesures brutes du même script (audit 01, SCAN).
// « atténué » = couleur rendue ≠ couleur déclarée : une opacité héritée (désactivé, périmé,
// colonne non active) a modifié le texte. Critère objectif, lu dans les données.
import fs from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const B = load(beforePath);
const A = load(afterPath);

const toHex = (s) => {
  if (!s) return s;
  if (s.startsWith('#')) return s.toLowerCase();
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return s;
  const p = m[1].split(/[ ,/]+/).map(Number);
  return '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
};
const dimmed = (c) => toHex(c.fg) !== toHex(c.fgRaw);

function summarize(M) {
  const out = {};
  for (const w of ['360', '768', '1440']) {
    const pages = Object.keys(M).filter((k) => k.endsWith('-' + w));
    let texts = 0, ko = 0, koSteady = 0, overImgKo = 0;
    const fonts = {};
    let targets = 0, under24 = 0, under32 = 0;
    for (const k of pages) {
      for (const c of M[k].contrast) {
        if (c.overImage || !c.opaque) { if (!c.pass) overImgKo += c.n ?? 1; continue; }
        texts += 1;
        if (!c.pass) { ko += 1; if (!dimmed(c)) koSteady += 1; }
      }
      for (const [s, n] of Object.entries(M[k].fonts)) fonts[s] = (fonts[s] || 0) + n;
      for (const t of M[k].targets) { targets++; const m = Math.min(t.w, t.h); if (m < 24) under24++; if (m < 32) under32++; }
    }
    const totalFonts = Object.values(fonts).reduce((a, b) => a + b, 0);
    const pct = (pred) => Math.round((100 * Object.entries(fonts).filter(([s]) => pred(+s)).reduce((a, [, n]) => a + n, 0)) / totalFonts);
    out[w] = {
      pages: pages.length,
      styles: texts,
      echecs: ko,
      echecsPct: Math.round((100 * ko) / texts),
      echecsHorsAttenues: koSteady,
      surImageEchecs: overImgKo,
      sous11px: pct((s) => s < 11),
      a9px: pct((s) => s <= 9),
      a10px: pct((s) => s > 9 && s < 11),
      cibles: targets,
      ciblesSous24: under24,
      ciblesSous32: under32,
    };
  }
  return out;
}

function perPage(M, names) {
  const res = {};
  for (const k of names) {
    if (!M[k]) { res[k] = '—'; continue; }
    const c = M[k].contrast.filter((x) => !x.overImage && x.opaque);
    const ko = c.filter((x) => !x.pass);
    res[k] = `${ko.length}/${c.length} (hors atténués ${ko.filter((x) => !dimmed(x)).length})`;
  }
  return res;
}

function steadyFailures(M) {
  const agg = new Map();
  for (const [k, m] of Object.entries(M)) for (const c of m.contrast) {
    if (c.pass || dimmed(c)) continue;
    const id = `${c.sample.slice(0, 30)}|${toHex(c.fg)}|${c.bg}|${c.overImage ? 'img' : ''}`;
    const cur = agg.get(id) ?? { ratio: c.ratio, fg: toHex(c.fg), bg: c.bg, size: c.size, sample: c.sample.slice(0, 40), cls: (c.cls || '').slice(0, 60), overImage: c.overImage, pages: new Set() };
    cur.pages.add(k);
    agg.set(id, cur);
  }
  return [...agg.values()].sort((a, b) => a.ratio - b.ratio).map((r) => ({ ...r, pages: [...r.pages].join(',') }));
}

const names = ['login-360', 'register-360', 'home-1440', 'home-vide-1440', 'import-dialog-1440', 'editor-annoter-1440', 'editor-annoter-360', 'editor-stats-360', 'editor-combos-1440', 'editor-inventaire-1440', 'editor-mains-1440', 'editor-side-1440', 'compare-1440', 'fiche-1440', 'fiche-print-1440'];
console.log(JSON.stringify({ avant: summarize(B), apres: summarize(A), parPage: { avant: perPage(B, names), apres: perPage(A, names) }, echecsRestantsHorsAttenues: steadyFailures(A) }, null, 1));
