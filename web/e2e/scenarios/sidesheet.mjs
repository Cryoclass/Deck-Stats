// Étape 10D, fiche retouchée le 11 septembre 2026 : fiche imprimable et comparateur sur un deck
// sidé (Deck A, 1440 px) :
//   F1 onglet « Plans de side » : « Fiche imprimable » actif (deck enregistré), mène à
//      /decks/:id/side/fiche ;
//   F2 fiche : 7 adversaires dans l'ordre d'ajout, volets Premier / Second ; dans chaque volet prêt,
//      un cadre SORT (pointillé) et un cadre ENTRE (plein) ; vignettes chargées, GROS badge « ×n »
//      (≥ 28 px) sur une carte en plusieurs copies ; noms masqués par défaut, case « Noms des
//      cartes » qui les affiche et se retient au rechargement ; notes ; plan incomplet signalé
//      sans chiffre ; « — » avant calcul ;
//   F3 « Tout calculer » : 13 plans prêts chiffrés, persistés (API), « Chiffres à jour » ;
//      rechargement : chiffres relus depuis le cache, rien à calculer ;
//   F4 impression : fond blanc, barre d'outils masquée, badges et cadres en couleurs forcées
//      (`print-color-adjust: exact`), PDF A4 (fonds non imprimés, comme par défaut dans Chrome)
//      de 3 pages au plus pour 7 adversaires, soit au moins 3 adversaires par page ; puis
//      « Télécharger le PDF » (plus de bouton « Imprimer ») : fichier nommé, 3 pages au plus,
//      adversaires, cadres SORT / ENTRE et notes en texte, illustrations intégrées ;
//   F5 comparateur Deck A vs Deck A sidé (plan second de « Kewl Tune ») : trois sections, nom du deck
//      sidé, note d'information, matrices différentes ; plan incomplet : refus explicite ;
//   puis la fixture est restaurée (aucun adversaire, side vide, starters d'origine), vérifiée par l'API.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { launch, login, shot, deckId, box, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const RHO = 90000017; // Side Rho : side seulement
const OMICRON = 90000015; // Filler Omicron : 1 en main, 2 en side
const IOTA = 90000009; // Quick-Play Iota : 2 en main, 1 en side
const LAMBDA = 90000011; // Filler Lambda : 3 en main
const MU = 90000012; // Filler Mu : 3 en main
const NU = 90000013; // Filler Nu : 3 en main
const NAMES = ['Kewl Tune', 'Snake-Eye', 'Yubel', 'Tenpai', 'Branded', 'Ryzeal', 'Maliss'];

export default async function sidesheet({ out }) {
  const { expect, ge, done } = checker('fiche de side');
  const { browser, context, page } = await launch();
  await login(context);
  const id = await deckId(context, DECK_A);
  const detail = async () => (await context.request.get(`/api/decks/${id}`)).json();
  const configurationOf = (d) => ({
    version: 2, name: d.name, cards: d.cards, starters: d.starters, pairs: d.pairs, conditions: d.conditions ?? [],
    deadFirst: d.deadFirst, deadSecond: d.deadSecond, matchups: d.matchups ?? [], params: d.params ?? {}, notes: d.notes ?? null,
  });
  const put = async (configuration) => {
    const d = await detail();
    const r = await context.request.put(`/api/decks/${id}`, { data: { configuration, expectedRevision: d.revision } });
    if (!r.ok()) throw new Error(`PUT → ${r.status()} ${await r.text()}`);
  };
  const before = await detail();
  const original = configurationOf(before);
  expect('fixture : side vide, aucun adversaire', before.cards.every((c) => c.zone !== 'side') && (before.matchups ?? []).length === 0);

  // Sept adversaires aux plans réalistes (trois cartes par liste en premier) ; « Snake-Eye » a un
  // plan second incomplet (3 sortent, 2 entrent).
  const ids = NAMES.map(() => randomUUID());
  const matchups = NAMES.map((name, i) => ({
    id: ids[i], name, sort_index: i, plans: [
      { position: 'first', note: `${name} : garder un Rho pour leur tour 1`,
        outgoing: [{ card_id: MU, copies: 1 }, { card_id: NU, copies: 1 }, { card_id: LAMBDA, copies: 1 }],
        incoming: [{ card_id: RHO, copies: 1 }, { card_id: OMICRON, copies: 1 }, { card_id: IOTA, copies: 1 }] },
      { position: 'second', note: `${name} : tout sur le board breaker`,
        outgoing: [{ card_id: MU, copies: 2 }, { card_id: NU, copies: 1 }],
        incoming: name === 'Snake-Eye' ? [{ card_id: RHO, copies: 2 }] : [{ card_id: RHO, copies: 2 }, { card_id: OMICRON, copies: 1 }] },
    ],
  }));
  await put({
    ...original,
    cards: [...original.cards, { card_id: RHO, zone: 'side', copies: 3 }, { card_id: OMICRON, zone: 'side', copies: 2 }, { card_id: IOTA, zone: 'side', copies: 1 }],
    matchups,
  });
  const kewl = ids[0];
  const snake = ids[1];
  const ready = () => page.locator('[data-sheet-figures="ready"]').count();
  const captions = () => page.locator('[data-sheet-card] figcaption').count();

  try {
    // ─── F1 : depuis l'onglet ───
    await page.goto(`/decks/${id}/side`);
    await page.waitForSelector('[data-side-planner]');
    const openSheet = page.locator('[data-open-sheet]');
    expect('F1 « Fiche imprimable » actif (deck enregistré)', await openSheet.isEnabled());
    await openSheet.click();
    await page.waitForSelector('[data-side-sheet]');
    expect('F1 adresse de la fiche', page.url().endsWith(`/decks/${id}/side/fiche`), page.url());

    // ─── F2 : contenu avant calcul ───
    await page.waitForSelector('[data-sheet-matchup]');
    const order = await page.locator('[data-sheet-matchup]').evaluateAll((els) => els.map((e) => e.getAttribute('data-sheet-matchup')));
    expect('F2 sept adversaires dans l’ordre d’ajout', JSON.stringify(order) === JSON.stringify(NAMES), order);
    expect('F2 deux volets par adversaire', (await page.locator('[data-sheet-plan]').count()) === 14);
    expect('F2 chaque volet a un cadre SORT et un cadre ENTRE', (await page.locator('[data-swap-box="out"]').count()) === 14 && (await page.locator('[data-swap-box="in"]').count()) === 14);
    const styles = await page.locator('[data-swap-box]').first().evaluate((el) => getComputedStyle(el).borderStyle);
    const stylesIn = await page.locator('[data-swap-box="in"]').first().evaluate((el) => getComputedStyle(el).borderStyle);
    expect('F2 SORT en pointillé, ENTRE en trait plein (lisible en noir et blanc)', styles === 'dashed' && stylesIn === 'solid', { styles, stylesIn });
    expect('F2 plan incomplet signalé, sans chiffre', (await page.locator('[data-sheet-plan][data-status="incomplete"]').count()) === 1
      && (await page.locator('[data-sheet-plan][data-status="incomplete"] [data-sheet-figures]').count()) === 0);
    // L'onglet ouvert en F1 a pu calculer et PERSISTER le volet qu'il affichait (Kewl Tune, premier :
    // deck enregistré, comportement voulu) avant le clic sur « Fiche imprimable ».
    const missing = await page.locator('[data-sheet-figures="missing"]').count();
    const readyBefore = await ready();
    expect('F2 13 plans prêts, « — » sauf au plus le volet déjà calculé dans l’onglet', missing + readyBefore === 13 && missing >= 12, { missing, readyBefore });
    const images = await page.locator('[data-sheet-matchup] img').evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth > 0));
    expect('F2 vignettes chargées', images.length > 0 && images.every(Boolean), { n: images.length, ko: images.filter((x) => !x).length });
    ge('F2 vignette assez grande pour se passer du nom (≥ 56 px de large)', await box(page.locator('[data-sheet-card] img').first()), 56);
    const badge = page.locator('[data-copies-badge]').first();
    ge('F2 badge « ×n » bien gros (≥ 28 px)', await box(badge), 28);
    expect('F2 badge « ×2 » sur Filler Mu en second', /×2/.test(await page.locator(`[data-sheet-matchup="Kewl Tune"] [data-sheet-plan="second"] [data-sheet-card="${MU}"] [data-copies-badge]`).innerText()));
    expect('F2 aucune pastille pour une seule copie', (await page.locator(`[data-sheet-matchup="Kewl Tune"] [data-sheet-plan="first"] [data-copies-badge]`).count()) === 0);
    expect('F2 noms masqués par défaut', (await captions()) === 0 && !(await page.locator('[data-toggle-names]').isChecked()));
    await page.locator('[data-toggle-names]').check();
    expect('F2 case cochée : les noms s’affichent', (await captions()) > 0 && /Filler Mu/.test(await page.locator('[data-sheet-matchup="Kewl Tune"]').innerText()));
    await page.reload();
    await page.waitForSelector('[data-sheet-matchup]');
    expect('F2 préférence retenue au rechargement', (await page.locator('[data-toggle-names]').isChecked()) && (await captions()) > 0);
    await page.locator('[data-toggle-names]').uncheck();
    expect('F2 case décochée : noms masqués', (await captions()) === 0);
    expect('F2 notes imprimées', /Kewl Tune : tout sur le board breaker/.test(await page.locator('[data-sheet-matchup="Kewl Tune"]').innerText()));
    const label = await page.locator('[data-compute-all]').innerText();
    expect('F2 « Tout calculer » annonce les plans restants', label.includes(`Tout calculer (${missing})`), label);

    // ─── F3 : tout calculer, persistance, relecture ───
    await page.locator('[data-compute-all]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-sheet-figures="ready"]').length === 13, null, { timeout: 60000 });
    await page.waitForSelector('[data-compute-all]:has-text("Chiffres à jour")', { timeout: 10000 });
    let persisted = [];
    for (let i = 0; i < 40 && persisted.length < 13; i++) {
      persisted = (await detail()).plan_summaries ?? [];
      if (persisted.length < 13) await page.waitForTimeout(250);
    }
    expect('F3 13 chiffres persistés (API)', persisted.length === 13, persisted.length);
    await page.reload();
    await page.waitForSelector('[data-sheet-matchup]');
    expect('F3 rechargement : chiffres relus, rien à calculer', (await ready()) === 13 && (await page.locator('[data-compute-all]').isDisabled()));
    await shot(page, 'sidesheet-1440', { fullPage: true });

    // ─── F4 : impression ───
    await page.emulateMedia({ media: 'print' });
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect('F4 impression sur fond blanc', background === 'rgb(255, 255, 255)', background);
    expect('F4 barre d’outils masquée à l’impression', !(await page.locator('[data-compute-all]').isVisible()) && !(await page.locator('[data-toggle-names]').isVisible()));
    const exact = await page.locator('[data-copies-badge]').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return s.printColorAdjust || s.webkitPrintColorAdjust;
    });
    const exactBox = await page.locator('[data-swap-box]').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return s.printColorAdjust || s.webkitPrintColorAdjust;
    });
    expect('F4 badges et cadres impriment leurs couleurs (fonds non imprimés par défaut dans Chrome)', exact === 'exact' && exactBox === 'exact', { exact, exactBox });
    await shot(page, 'sidesheet-print', { fullPage: true });
    const pdf = await page.pdf({ path: path.join(out, 'sidesheet.pdf'), format: 'A4', preferCSSPageSize: true, printBackground: false });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
    expect('F4 impression du navigateur : au moins 3 adversaires par page A4 (7 en 3 pages au plus)', pages >= 1 && pages <= 3, pages);
    await page.emulateMedia({ media: 'screen' });

    // ─── F4 bis : « Télécharger le PDF » (remplace « Imprimer ») ───
    expect('F4 plus de bouton « Imprimer »', (await page.locator('[data-print]').count()) === 0);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('[data-download-pdf]'),
    ]);
    const file = path.join(out, 'sidesheet-download.pdf');
    await download.saveAs(file);
    expect('F4 nom du fichier', /^plans-de-side_Deck_A_\d{4}-\d{2}-\d{2}\.pdf$/.test(download.suggestedFilename()), download.suggestedFilename());
    const bytes = (await (await import('node:fs/promises')).readFile(file)).toString('latin1');
    const downloadedPages = (bytes.match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
    expect('F4 PDF téléchargé : au moins 3 adversaires par page A4 (7 en 3 pages au plus)', downloadedPages >= 1 && downloadedPages <= 3, downloadedPages);
    const words = ['Kewl Tune', 'Maliss', '- SORT', '+ ENTRE', 'tout sur le board breaker'];
    expect('F4 PDF : adversaires, cadres SORT / ENTRE et notes', words.every((w) => bytes.includes(w)), words.filter((w) => !bytes.includes(w)));
    const embedded = (bytes.match(/\/Subtype\s*\/Image/g) ?? []).length;
    expect('F4 PDF : les illustrations sont intégrées (6 cartes distinctes)', embedded >= 6, embedded);

    // ─── F5 : comparateur sur un deck sidé ───
    // Side Rho devient starter : l'échange Filler Mu ↔ Side Rho change alors le deck. Deux cartes
    // neutres échangées donneraient des matrices identiques, et la garde passerait même si le
    // comparateur oubliait d'appliquer le plan. Restauré avec la fixture.
    const current = configurationOf(await detail());
    await put({ ...current, starters: [...current.starters, RHO] });
    await page.goto(`/compare/${id}/${id}~${kewl}~second`);
    await page.waitForSelector('h2:has-text("Synthèse")', { timeout: 30000 });
    const header = await page.locator('header').first().innerText();
    expect('F5 le côté B est le deck sidé nommé', /B\. Deck A — Kewl Tune \(second\)/.test(header), header);
    expect('F5 trois sections (premier, second, synthèse)', (await page.locator('section').count()) === 3);
    const notes = (await page.locator('div.mb-4 > div').allTextContents()).join(' | ');
    expect('F5 note : seul le scénario second correspond au plan', /seul le scénario second correspond à ce plan/.test(notes), notes);
    expect('F5 le plan est appliqué : les matrices diffèrent', !/matrices identiques/.test(notes), notes);
    const deltaSecond = await page.locator('section').nth(1).locator('table').nth(2).locator('tbody td[title]').allTextContents();
    expect('F5 Δ second : au moins une cellule non nulle', deltaSecond.some((t) => t.trim() !== '' && t.trim() !== '·'), deltaSecond);
    await shot(page, 'sidesheet-compare', { fullPage: true });
    await page.goto(`/compare/${id}/${id}~${snake}~second`);
    await page.waitForSelector('text=/incomplet : rien à comparer/', { timeout: 20000 });
    expect('F5 plan incomplet : refus explicite', true);
  } finally {
    await put(original).catch((e) => expect('restauration de la fixture', false, String(e)));
    const after = await detail().catch(() => null);
    expect('fixture restaurée (side vide, aucun adversaire, starters d’origine)',
      !!after && after.cards.every((c) => c.zone !== 'side') && (after.matchups ?? []).length === 0
        && JSON.stringify([...after.starters].sort()) === JSON.stringify([...original.starters].sort()),
      after && { side: after.cards.filter((c) => c.zone === 'side'), matchups: (after.matchups ?? []).length });
    await browser.close();
  }
  done();
}
