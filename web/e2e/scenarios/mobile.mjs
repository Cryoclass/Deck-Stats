// Étape 7B, point 3 : responsive du comparateur et du mur de mains, verdict par point et
// par largeur (360 / 390 / 768 tactiles, 1440 en non-régression). Chaque point du plan
// (docs/etape-7.md, point 3) est mesuré puis capturé ; une garde qui échoue est listée
// avec sa mesure, toutes les largeurs sont jouées avant l'échec global.
//   P1 en-tête du comparateur · P2 dialogue « Comparer deux decks » · P3 matrices A et B
//   côte à côte, Δ avec légende · P4 table de synthèse (défilement confiné, D1) · P5
//   bandeau d'avertissements · P6 export Excel réel · P7 mur de mains premier / second
//   (« 6ᵉ »), cibles, état périmé · P8 bureau 1440 (non-régression).
// Cibles : 32 px sur Exporter Excel, Comparer, ✕ du dialogue et ⇄ Inverser (Q4) ; 24 px
// ailleurs (contrat §6). Sous 640 px, A et B en cellules compactes sur la même ligne, Δ en
// dessous en pleine largeur (Q3).
import { statSync } from 'node:fs';
import path from 'node:path';
import { launch, login, shot, deckId, box, checker } from '../lib.mjs';
import { DECK_A, DECK_B } from './setup.mjs';

const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: true },
  { width: 1440, height: 900, mobile: false },
];

const fits = (el) => el.scrollWidth <= el.clientWidth + 1;
const inView = (el) => {
  const r = el.getBoundingClientRect();
  return r.left >= -0.5 && r.right <= window.innerWidth + 0.5 && r.width > 0;
};
const inViewFits = (el) => {
  const r = el.getBoundingClientRect();
  return r.left >= -0.5 && r.right <= window.innerWidth + 0.5 && el.scrollWidth <= el.clientWidth + 1;
};
const noBodyScroll = () => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1;
const rect = async (loc) => {
  const b = await loc.boundingBox();
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
};
const DELTA_TEXT = /^(·|[+\u2212]\d+\.\d+)$/; // signe « − » (U+2212) comme fmt.ts
const CARD_RATIO = 59 / 86; // charte §7.15 (aspect-[59/86])

export default async function mobile({ out, log }) {
  const verdicts = []; // { point, width, ok, detail }
  const failures = [];
  const a = { id: null };
  const b = { id: null };

  for (const cfg of WIDTHS) {
    const W = cfg.width;
    const { expect, ge, failures: local } = checker(`${W} px`);
    const point = (p, label, ok, detail) => {
      expect(`${p} ${label}`, ok, detail);
      verdicts.push({ point: p, width: W, label, ok: !!ok, detail });
    };
    const pointGe = (p, label, b, min) => point(p, `${label} ≥ ${min} px`, !!b && b.w >= min && b.h >= min, b);
    const { browser, context, page } = await launch(cfg);
    await login(context);
    a.id ??= await deckId(context, DECK_A);
    b.id ??= await deckId(context, DECK_B);

    // ── P2 : dialogue « Comparer deux decks » depuis l'accueil ──
    await page.goto('/decks');
    await page.waitForSelector('text=Mes decks');
    await page.waitForTimeout(300);
    pointGe('P2', 'accueil : ⇄ Comparer', await box(page.locator('header button:has-text("Comparer")')), 32);
    await page.click('header button:has-text("Comparer")');
    const dialog = page.locator('div.max-w-md', { has: page.locator('h2:has-text("Comparer deux decks")') });
    await dialog.waitFor();
    await page.waitForTimeout(200);
    point('P2', 'dialogue dans le viewport, sans débordement', await dialog.evaluate(inViewFits), await rect(dialog));
    const selects = dialog.locator('select');
    point('P2', 'deux sélecteurs', (await selects.count()) === 2);
    for (let i = 0; i < 2; i++) pointGe('P2', `sélecteur ${i === 0 ? 'A' : 'B'}`, await box(selects.nth(i)), 24);
    pointGe('P2', '✕ (Q4)', await box(dialog.locator('button[title="Fermer"]')), 32);
    pointGe('P2', 'Comparer (Q4)', await box(dialog.locator('button:has-text("Comparer")')), 32);
    await shot(page, `mobile-${W}-dialogue`);
    await selects.nth(0).selectOption(a.id);
    await selects.nth(1).selectOption(b.id);
    await dialog.locator('button:has-text("Comparer")').click();
    await page.waitForURL(/\/compare\//);

    // ── P1 : en-tête du comparateur ──
    await page.waitForSelector('h2:has-text("Synthèse")', { timeout: 30000 });
    await page.waitForTimeout(400);
    const header = page.locator('header');
    point('P1', 'en-tête sans débordement', await header.evaluate(fits), await header.evaluate((el) => [el.scrollWidth, el.clientWidth]));
    point('P1', 'body sans défilement horizontal', await page.evaluate(noBodyScroll), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    const inverser = page.locator('header button:has-text("Inverser")');
    const exporter = page.locator('header button:has-text("Exporter Excel")');
    point('P1', '⇄ Inverser dans le viewport', await inverser.evaluate(inView), await rect(inverser));
    point('P1', 'Exporter Excel dans le viewport', await exporter.evaluate(inView), await rect(exporter));
    const bInv = await box(inverser);
    const bExp = await box(exporter);
    pointGe('P1', '⇄ Inverser (Q4)', bInv, 32);
    pointGe('P1', 'Exporter Excel (Q4)', bExp, 32);
    point('P1', 'libellés des actions sur une ligne', bInv?.h <= 36 && bExp?.h <= 36, { inverser: bInv, exporter: bExp });
    const back = await box(page.locator('header button:has-text("Mes decks")'));
    point('P1', '« ← Mes decks » sur une ligne', back?.h <= 20, back);
    const names = page.locator('header span.truncate').first();
    point('P1', 'noms A / B visibles', (await names.isVisible()) && (await names.evaluate((el) => el.getBoundingClientRect().width >= 40)), await rect(names));

    // ── P5 : bandeau d'avertissements ──
    const warnings = page.locator('div.mb-4 > div');
    const wTexts = await warnings.allTextContents();
    point('P5', 'avertissement Q5 pour chaque deck', wTexts.filter((t) => /sans profil/.test(t)).length === 2, wTexts);
    for (let i = 0; i < (await warnings.count()); i++) {
      point('P5', `avertissement ${i + 1} dans le viewport, sans débordement`, await warnings.nth(i).evaluate(inViewFits), await rect(warnings.nth(i)));
    }

    // ── P3 / P8 : matrices A et B côte à côte, Δ avec légende, échelle commune ──
    const sections = page.locator('section');
    point('P3', 'trois sections', (await sections.count()) === 3, await sections.count());
    for (const [k, name] of [[0, 'premier'], [1, 'second']]) {
      const section = sections.nth(k);
      const cards = section.locator(':scope > div > div');
      point('P3', `${name} : trois cartes (A, B, Δ)`, (await cards.count()) === 3, await cards.count());
      const [rA, rB, rD] = await Promise.all([rect(cards.nth(0)), rect(cards.nth(1)), rect(cards.nth(2))]);
      const rS = await rect(section);
      point('P3', `${name} : A et B sur la même ligne`, rA && rB && Math.abs(rA.y - rB.y) <= 1 && rB.x >= rA.x + rA.w - 1, { A: rA, B: rB });
      point('P3', `${name} : A et B dans le viewport`, (await cards.nth(0).evaluate(inView)) && (await cards.nth(1).evaluate(inView)), { A: rA, B: rB });
      for (const [i, nm] of [[0, 'A'], [1, 'B']]) {
        const table = cards.nth(i).locator('table');
        point('P3', `${name} : matrice ${nm} entière (aucun défilement interne)`, await table.evaluate((t) => t.parentElement.scrollWidth <= t.parentElement.clientWidth + 1), await table.evaluate((t) => [t.parentElement.scrollWidth, t.parentElement.clientWidth]));
        const cells = table.locator('tbody td[title]');
        point('P3', `${name} : matrice ${nm} 24 cellules`, (await cells.count()) === 24);
        const metrics = await cells.evaluateAll((tds) => tds.map((td) => ({ w: td.getBoundingClientRect().width, h: td.getBoundingClientRect().height, font: parseFloat(getComputedStyle(td).fontSize), clipped: td.scrollWidth > td.clientWidth + 1 })));
        const minFont = Math.min(...metrics.map((m) => m.font));
        const minH = Math.min(...metrics.map((m) => m.h));
        point('P3', `${name} : matrice ${nm} cellules lisibles (police ≥ 9 px, hauteur ≥ 14 px, aucune coupée)`, minFont >= 9 && minH >= 14 && !metrics.some((m) => m.clipped), { minFont, minH, clipped: metrics.filter((m) => m.clipped).length });
        point('P3', `${name} : ligne S / N sous ${nm}`, /starters · N =/.test(await cards.nth(i).innerText()));
        const heads = await table.locator('thead th').evaluateAll((ths) => ths.slice(1).map((th) => Math.round(th.getBoundingClientRect().width)));
        point('P3', `${name} : matrice ${nm} colonnes ≥ 18 px (en-têtes distincts)`, heads.length === 6 && heads.every((w) => w >= 18), heads);
        if (W < 640) point('P3', `${name} : matrice ${nm} garde ≥ 3 px de marge dans sa carte`, await table.evaluate((t) => t.parentElement.clientWidth - t.getBoundingClientRect().width >= 3), await table.evaluate((t) => t.parentElement.clientWidth - t.getBoundingClientRect().width));
      }
      point('P3', `${name} : Δ avec légende`, /pas nécessairement meilleur/.test(await cards.nth(2).innerText()));
      point('P3', `${name} : Δ dans le viewport`, await cards.nth(2).evaluate(inView), rD);
      if (W < 640) point('P3', `${name} : Δ sous A / B en pleine largeur`, rD && rA && rD.y >= rA.y + rA.h && rD.w >= 0.95 * rS.w, { D: rD, section: rS });
      if (W >= 1024) point('P8', `${name} : A, B et Δ sur la même ligne (bureau)`, rA && rD && Math.abs(rA.y - rD.y) <= 1, { A: rA, D: rD });
    }
    await shot(page, `mobile-${W}-comparateur`, { fullPage: true });
    await sections.nth(0).screenshot({ path: path.join(out, `mobile-${W}-matrices.png`) });
    log(`capture mobile-${W}-matrices`);

    // ── P4 : table de synthèse ──
    const synthWrap = sections.nth(2).locator('div.overflow-x-auto');
    point('P4', 'conteneur de synthèse dans le viewport', await synthWrap.evaluate(inView), await rect(synthWrap));
    const synthScroll = await synthWrap.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflowX: getComputedStyle(el).overflowX }));
    point('P4', 'défilement de la synthèse confiné à son conteneur', synthScroll.overflowX === 'auto' && (await page.evaluate(noBodyScroll)), synthScroll);
    const deltaTexts = await sections.nth(2).locator('tbody tr').evaluateAll((trs) => trs.flatMap((tr) => [3, 6].map((k) => { const td = tr.children[k]; return { text: td.textContent.trim(), title: td.title }; })));
    point('P4', '24 deltas de synthèse', deltaTexts.length === 24, deltaTexts.length);
    point('P4', 'D1 : « · » = zéro exact, sinon signe + décimale', deltaTexts.every((d) => DELTA_TEXT.test(d.text) && (d.text !== '·' || /^(0\.00 pt|0\.000)$/.test(d.title))), deltaTexts.filter((d) => !DELTA_TEXT.test(d.text)).slice(0, 3));
    point('P4', 'au moins un delta non nul lisible', deltaTexts.some((d) => d.text !== '·'));

    // ── P6 : export Excel réel ──
    // Non bloquant : un export impossible est une garde en échec, pas une exception qui
    // masquerait les autres verdicts de la largeur.
    let exported = { size: 0, error: null };
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        exporter.click({ timeout: 5000 }),
      ]);
      const file = path.join(out, `mobile-${W}-export.xlsx`);
      await download.saveAs(file);
      exported.size = statSync(file).size;
    } catch (e) {
      exported.error = e instanceof Error ? e.message.split(/\r?\n/)[0] : String(e);
    }
    point('P6', 'export Excel téléchargé', exported.size > 1000, exported);

    // ── P7 : mur de mains, premier puis second, état périmé ──
    // Worker ralenti à 4 s par réécriture du script servi (moteur, worker et client
    // intacts, comme M6) : le calcul initial dure 4 s, et un changement de copies laisse
    // le temps d'ouvrir le mur pendant l'état périmé.
    await page.route((u) => u.href.includes('engine.worker.ts') && u.href.includes('worker_file'), async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\n;{ const h = self.onmessage; self.onmessage = (e) => { const t = Date.now(); while (Date.now() - t < 4000) {} h(e); }; }\n`;
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
    });
    await page.goto('/decks/' + a.id);
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 30000 });
    await page.click('nav button:has-text("Mur de mains")');
    const wall = page.locator('main');
    const rows = wall.locator('div.rounded-md.border', { has: page.locator('img') });
    await rows.first().waitFor();
    await page.waitForTimeout(400);
    const bar = wall.locator('div.border-b', { has: page.locator('button:has-text("Nouvelles mains")') }).first();
    point('P7', 'barre de contrôle sans débordement', await bar.evaluate(fits), await bar.evaluate((el) => [el.scrollWidth, el.clientWidth]));
    point('P7', 'body sans défilement horizontal (mur)', await page.evaluate(noBodyScroll));
    pointGe('P7', 'Nouvelles mains', await box(wall.locator('button:has-text("Nouvelles mains")')), 24);
    pointGe('P7', 'contexte Premier', await box(wall.locator('button:has-text("Premier · 5")')), 24);
    pointGe('P7', 'contexte Second', await box(wall.locator('button:has-text("Second · 5 + pioche")')), 24);
    pointGe('P7', 'sélecteur n', await box(wall.locator('select').first()), 24);
    pointGe('P7', 'filtre par requête', await box(wall.locator('button:has-text("par requête")')), 24);
    pointGe('P7', 'tri', await box(wall.locator('button[title^="Trier"]')), 24);
    const rowCheck = async (label, nImgs) => {
      const row = rows.first();
      const r = await rect(row);
      point('P7', `${label} : ligne de main dans le viewport`, await row.evaluate(inView), r);
      point('P7', `${label} : ligne de main sans débordement`, await row.evaluate(fits), await row.evaluate((el) => [el.scrollWidth, el.clientWidth]));
      point('P7', `${label} : ${nImgs} cartes par main`, (await row.locator('img').count()) === nImgs, await row.locator('img').count());
      const imgs = await row.locator('img').evaluateAll((els) => els.map((e) => ({ w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), inView: e.getBoundingClientRect().right <= window.innerWidth + 0.5 })));
      point('P7', `${label} : cartes entières, non déformées (ratio 59/86), ≥ 40 px de large`, imgs.every((i) => i.inView && i.w >= 40 && Math.abs(i.w / i.h - CARD_RATIO) <= 0.03), imgs);
      const recap = row.locator('div.ml-auto');
      point('P7', `${label} : départs / non-engine / note dans le viewport`, await recap.evaluate(inView), await rect(recap));
    };
    await rowCheck('premier', 5);
    await shot(page, `mobile-${W}-mains-premier`);
    await wall.locator('button:has-text("Second · 5 + pioche")').click();
    await page.waitForTimeout(400);
    await rowCheck('second', 6);
    const badge = rows.first().locator('span.absolute', { hasText: '6ᵉ' });
    point('P7', 'second : badge « 6ᵉ » visible', await badge.isVisible() && (await badge.evaluate(inView)), await rect(badge));
    point('P7', 'second : mention « sixième carte = pioche »', await wall.locator('text=sixième carte = pioche').isVisible());
    await shot(page, `mobile-${W}-mains-second`);

    // État périmé : une copie de plus (onglet Annoter), retour au mur pendant le recalcul.
    await page.click('nav button:has-text("Annoter")');
    await page.waitForSelector('button[title="Filler Omicron"]');
    await page.locator('div.group', { has: page.locator('button[title="Filler Omicron"]') }).locator('button[title="Plus de copies"]').click();
    await page.click('nav button:has-text("Mur de mains")');
    const status = wall.locator('[role="status"]');
    await status.waitFor({ timeout: 3000 }).catch(() => {});
    const staleText = (await status.count()) ? await status.innerText() : '';
    const listOpacity = await wall.locator('div.transition-opacity').evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
    await shot(page, `mobile-${W}-mains-perime`);
    point('P7', 'état périmé annoncé', /Recalcul/.test(staleText) && /version précédente/.test(staleText), staleText);
    point('P7', 'mains atténuées pendant le recalcul', listOpacity === '0.45', listOpacity);
    point('P7', 'état périmé dans le viewport', (await status.count()) > 0 && (await status.evaluate(inView)), await rect(status));
    await status.waitFor({ state: 'detached', timeout: 20000 });
    await page.waitForTimeout(300);
    point('P7', 'mains à 1 après le recalcul', (await wall.locator('div.transition-opacity').evaluate((el) => getComputedStyle(el).opacity)) === '1');
    await browser.close();
    failures.push(...local);
  }

  // Verdict par point et par largeur.
  const points = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  log('verdict        ' + WIDTHS.map((w) => String(w.width).padStart(8)).join(''));
  for (const p of points) {
    const cols = WIDTHS.map((w) => {
      const vs = verdicts.filter((v) => v.point === p && v.width === w.width);
      if (!vs.length) return '—'.padStart(8);
      const ko = vs.filter((v) => !v.ok).length;
      return (ko ? `CASSÉ ${ko}` : 'conforme').padStart(8);
    });
    log(`${p.padEnd(15)}${cols.join('')}`);
  }
  if (failures.length) throw new Error(`gardes en échec :\n  ${failures.join('\n  ')}`);
}
