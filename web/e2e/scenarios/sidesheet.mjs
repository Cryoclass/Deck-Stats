// Étape 10D : fiche imprimable et comparateur sur un deck sidé (Deck A, 1440 px) :
//   F1 onglet « Plans de side » : « Fiche imprimable » actif (deck enregistré), mène à
//      /decks/:id/side/fiche ;
//   F2 fiche : 7 adversaires dans l'ordre d'ajout, volets Premier / Second, vignettes chargées,
//      notes ; le plan incomplet est signalé sans chiffre ; « — » partout avant calcul ;
//   F3 « Tout calculer » : 13 plans prêts chiffrés, persistés (API), « Chiffres à jour » ;
//      rechargement : chiffres relus depuis le cache, rien à calculer ;
//   F4 impression : fond blanc, barre d'outils masquée, PDF A4 d'UNE page pour 7 adversaires (D15) ;
//   F5 comparateur Deck A vs Deck A sidé (plan second de « Kewl Tune ») : trois sections, nom du deck
//      sidé, note d'information ; plan incomplet : refus explicite ;
//   puis la fixture est restaurée (aucun adversaire, side vide), vérifiée par l'API.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { launch, login, shot, deckId, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const RHO = 90000017; // Side Rho : side seulement
const MU = 90000012; // Filler Mu : 3 en main
const NU = 90000013; // Filler Nu : 3 en main
const NAMES = ['Kewl Tune', 'Snake-Eye', 'Yubel', 'Tenpai', 'Branded', 'Ryzeal', 'Maliss'];

export default async function sidesheet({ out }) {
  const { expect, done } = checker('fiche de side');
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

  // Sept adversaires ; « Snake-Eye » a un plan second incomplet (2 sortent, 1 entre).
  const ids = NAMES.map(() => randomUUID());
  const matchups = NAMES.map((name, i) => ({
    id: ids[i], name, sort_index: i, plans: [
      { position: 'first', note: `${name} : garder un Rho pour leur tour 1`, outgoing: [{ card_id: MU, copies: 1 }, { card_id: NU, copies: 1 }], incoming: [{ card_id: RHO, copies: 2 }] },
      { position: 'second', note: `${name} : tout sur le board breaker`, outgoing: [{ card_id: MU, copies: 2 }], incoming: [{ card_id: RHO, copies: name === 'Snake-Eye' ? 1 : 2 }] },
    ],
  }));
  await put({ ...original, cards: [...original.cards, { card_id: RHO, zone: 'side', copies: 3 }], matchups });
  const kewl = ids[0];
  const snake = ids[1];
  const ready = () => page.locator('[data-sheet-figures="ready"]').count();

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
    expect('F2 plan incomplet signalé, sans chiffre', (await page.locator('[data-sheet-plan][data-status="incomplete"]').count()) === 1
      && (await page.locator('[data-sheet-plan][data-status="incomplete"] [data-sheet-figures]').count()) === 0);
    // L'onglet ouvert en F1 a pu calculer et PERSISTER le volet qu'il affichait (Kewl Tune, premier :
    // deck enregistré, comportement voulu) avant le clic sur « Fiche imprimable ». Tous les autres
    // plans prêts sont « — » ; « Tout calculer » annonce exactement ceux qui restent.
    const missing = await page.locator('[data-sheet-figures="missing"]').count();
    const readyBefore = await ready();
    expect('F2 13 plans prêts, « — » sauf au plus le volet déjà calculé dans l’onglet', missing + readyBefore === 13 && missing >= 12, { missing, readyBefore });
    const images = await page.locator('[data-sheet-matchup] img').evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth > 0));
    expect('F2 vignettes chargées', images.length > 0 && images.every(Boolean), { n: images.length, ko: images.filter((x) => !x).length });
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
    expect('F4 barre d’outils masquée à l’impression', !(await page.locator('[data-compute-all]').isVisible()));
    await shot(page, 'sidesheet-print', { fullPage: true });
    const pdf = await page.pdf({ path: path.join(out, 'sidesheet.pdf'), format: 'A4', preferCSSPageSize: true, printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
    expect('F4 sept adversaires tiennent sur une page A4', pages === 1, pages);
    await page.emulateMedia({ media: 'screen' });

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
    expect('fixture restaurée (side vide, aucun adversaire)', !!after && after.cards.every((c) => c.zone !== 'side') && (after.matchups ?? []).length === 0,
      after && { side: after.cards.filter((c) => c.zone === 'side'), matchups: (after.matchups ?? []).length });
    await browser.close();
  }
  done();
}
