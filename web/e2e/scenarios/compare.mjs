// Comparateur, premier scénario (étape 7A) : la page se charge sur Deck A / Deck B,
// affiche ses quatre matrices, ses deltas, sa synthèse et l'avertissement Q5, et
// l'export Excel réel (téléchargement navigateur) porte les MÊMES nombres que l'écran :
// cellules relues par ExcelJS comparées aux infobulles (valeur fine, 2 décimales).
// Les verdicts responsives (360 / 390 / 768) relèvent de la session 7B.
import ExcelJS from 'exceljs';
import path from 'node:path';
import { launch, login, shot, deckId, checker } from '../lib.mjs';
import { DECK_A, DECK_B } from './setup.mjs';

const pct2 = (v) => `${(100 * v).toFixed(2)}%`;
const pt2 = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)} pt`;

export default async function compare({ out }) {
  const { expect, done } = checker('comparateur 1440 px');
  const { browser, context, page } = await launch();
  await login(context);
  const a = await deckId(context, DECK_A);
  const b = await deckId(context, DECK_B);
  await page.goto(`/compare/${a}/${b}`);
  await page.waitForSelector('h2:has-text("Synthèse")', { timeout: 30000 });
  await page.waitForTimeout(300);
  await shot(page, 'compare-1440', { fullPage: true });

  const sections = page.locator('main section, section');
  expect('trois sections (premier, second, synthèse)', (await sections.count()) === 3, await sections.count());
  expect('titres de scénario', (await page.locator('h2', { hasText: 'Premier · 5 cartes' }).count()) === 1 && (await page.locator('h2', { hasText: 'Second · 5 cartes + pioche' }).count()) === 1);
  const warnings = await page.locator('div.mb-4 > div').allTextContents();
  expect('avertissement Q5 pour chaque deck', warnings.filter((w) => /sans profil/.test(w)).length === 2, warnings);
  expect('aucune erreur bloquante', !warnings.some((w) => /bug de calcul/.test(w)), warnings);
  expect('bouton Exporter Excel actif', await page.locator('button:has-text("Exporter Excel")').isEnabled());

  // Tables : par section de scénario, A, B puis Δ ; cellules `td[title]` en ordre ligne / colonne.
  const readTable = async (section, k) => {
    const cells = section.locator('table').nth(k).locator('tbody td[title]');
    const n = await cells.count();
    const titles = [];
    for (let i = 0; i < n; i++) titles.push(await cells.nth(i).getAttribute('title'));
    return titles;
  };
  const screen = {};
  for (const [k, sheet] of [[0, 'Going First'], [1, 'Going Second']]) {
    const section = sections.nth(k);
    screen[sheet] = { A: await readTable(section, 0), B: await readTable(section, 1), D: await readTable(section, 2) };
    expect(`${sheet} : 24 cellules par matrice`, screen[sheet].A.length === 24 && screen[sheet].B.length === 24 && screen[sheet].D.length === 24);
  }

  // Export réel : téléchargement, relecture, comparaison nombre à nombre avec l'écran.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('button:has-text("Exporter Excel")'),
  ]);
  const file = path.join(out, 'compare-export.xlsx');
  await download.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  expect('trois onglets', wb.worksheets.map((w) => w.name).join('|') === 'Going First|Going Second|Synthèse', wb.worksheets.map((w) => w.name));
  const COLS = ['B', 'C', 'D', 'E', 'F', 'G'];
  for (const sheet of ['Going First', 'Going Second']) {
    const ws = wb.getWorksheet(sheet);
    const mismatches = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 6; j++) {
        const vA = ws.getCell(`${COLS[j]}${6 + i}`).value;
        const vB = ws.getCell(`${COLS[j]}${14 + i}`).value;
        if (typeof vA !== 'number' || typeof vB !== 'number') { mismatches.push(`${sheet} ${COLS[j]}${6 + i} non numérique`); continue; }
        const k = i * 6 + j;
        if (screen[sheet].A[k] !== pct2(vA)) mismatches.push(`A ${COLS[j]}${6 + i}: écran ${screen[sheet].A[k]} ≠ xlsx ${pct2(vA)}`);
        if (screen[sheet].B[k] !== pct2(vB)) mismatches.push(`B ${COLS[j]}${14 + i}: écran ${screen[sheet].B[k]} ≠ xlsx ${pct2(vB)}`);
        if (screen[sheet].D[k] !== pt2(vB - vA)) mismatches.push(`Δ ${COLS[j]}${22 + i}: écran ${screen[sheet].D[k]} ≠ xlsx ${pt2(vB - vA)}`);
      }
    }
    expect(`${sheet} : écran = classeur (A, B, Δ)`, mismatches.length === 0, mismatches.slice(0, 5));
  }
  await browser.close();
  done();
}
