// Étape 10C : plans de side. Gardes (Deck A, 1440 px puis 360 px) :
//   P1 une carte de side s'annote dans la grille (mode Starter) : tuile annotable (menu ⋯, « hors
//      calcul »), badge S posé, « non enregistré », AUCUN recalcul du deck de base ;
//   P2 onglet « Plans de side » : adversaire ajouté, volet Second, copies dépliées une par une ; clic
//      gauche ET clic droit sélectionnent ; « Échanger » refusé à −2 / +1, accepté à −2 / +2 ; copies
//      engagées estompées ; plan prêt, trois chiffres calculés, écart avec le deck de base affiché ;
//   P3 une copie engagée cliquée sort du plan : « incomplet », aucun chiffre ; rééquilibré : prêt ;
//   P4 note, enregistrement : l'API porte l'adversaire, son plan, sa note et le starter du side ;
//      les chiffres sont persistés (plan_summaries) une fois le deck enregistré ;
//   P5 lien profond /decks/:id/side après rechargement : plan et note relus, chiffres affichés ;
//   P6 à 360 px : « Échanger » et une copie à 32 px au moins, aucun débordement horizontal ;
//   puis la fixture est restaurée (side vide, aucun adversaire, starters d'origine), vérifiée par l'API.
import { launch, login, shot, deckId, box, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const RHO = 90000017; // Side Rho : side seulement
const LAMBDA = 90000011; // Filler Lambda : 3 en main, 1 en side (même carte dans deux zones, 9C)
const MU = 90000012; // Filler Mu : 3 en main
const NOTE = 'Garder Side Rho pour leur tour 2';

export default async function side() {
  const { expect, ge, done } = checker('plans de side');
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
  expect('fixture : side vide, aucun adversaire', before.cards.every((c) => c.zone !== 'side') && (before.matchups ?? []).length === 0, { cards: before.cards.length, matchups: before.matchups });
  await put({ ...original, cards: [...original.cards, { card_id: RHO, zone: 'side', copies: 3 }, { card_id: LAMBDA, zone: 'side', copies: 1 }] });

  const msLabel = () => page.locator('aside span.tnum').filter({ hasText: /ms$/ }).first().innerText();
  const saveBtn = () => page.locator('header button:has-text("Enregistrer")');
  const copies = (zone, card, state) => page.locator(`[data-copy="${zone}"][data-card-id="${card}"]${state ? `[data-state="${state}"]` : ''}`);
  const status = (s) => page.locator(`[data-plan-status="${s}"]`);
  const swap = () => page.locator('[data-swap]');

  try {
    // ─── P1 : annoter une carte de side, sans recalcul ───
    await page.goto('/decks/' + id);
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(300);
    const ms0 = await msLabel();
    const rho = page.locator(`[data-zone-block="side"] [data-zone-tile="side"][data-card-id="${RHO}"]`);
    expect('P1 tuile Side Rho annotable (menu ⋯)', (await rho.locator('button[title="Plus d\'actions"]').count()) === 1);
    expect('P1 tuile de side marquée « hors calcul »', (await rho.locator('[data-off-calc]').count()) === 1);
    await page.keyboard.press('s');
    await rho.locator('button[title="Side Rho"]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400); // > regroupement (50 ms) + calcul du deck A
    expect('P1 badge S posé sur Side Rho', (await rho.locator('span', { hasText: /^S$/ }).count()) >= 1);
    expect('P1 Enregistrer activé (non enregistré)', !(await saveBtn().isDisabled()));
    const ms1 = await msLabel();
    const recalc = await page.locator('text=Recalcul…').count();
    expect('P1 aucun recalcul du deck de base (durée inchangée, aucun « Recalcul… »)', ms1 === ms0 && recalc === 0, { ms0, ms1, recalc });
    await shot(page, 'side-1440-annoter');

    // ─── P2 : adversaire, copies dépliées, sélection, échange ───
    await page.locator('nav button', { hasText: 'Plans de side' }).click();
    await page.waitForSelector('text=Aucun adversaire');
    await page.fill('input[aria-label="Nom du nouvel adversaire"]', 'Kewl Tune');
    await page.locator('[data-add-matchup]').click();
    await page.waitForSelector('[data-side-planner]');
    expect('P2 adversaire « Kewl Tune » créé', (await page.locator('[data-matchup="Kewl Tune"]').count()) === 1);
    await page.getByRole('button', { name: 'Second', exact: true }).click();
    expect('P2 copies dépliées : 3 Filler Mu en main, 3 Side Rho et 1 Filler Lambda en side',
      (await copies('main', MU).count()) === 3 && (await copies('side', RHO).count()) === 3 && (await copies('side', LAMBDA).count()) === 1);
    await copies('main', MU).nth(0).click();
    await copies('main', MU).nth(1).click({ button: 'right' });
    await copies('side', RHO).nth(0).click();
    expect('P2 le clic droit sélectionne', (await copies('main', MU).nth(1).getAttribute('data-state')) === 'selected');
    expect('P2 « Échanger » refusé à −2 / +1', await swap().isDisabled());
    await copies('side', RHO).nth(1).click({ button: 'right' });
    expect('P2 « Échanger » actif à −2 / +2', !(await swap().isDisabled()));
    await swap().click();
    await page.waitForTimeout(200);
    expect('P2 copies engagées : 2 sortent, 2 entrent', (await copies('main', MU, 'engaged').count()) === 2 && (await copies('side', RHO, 'engaged').count()) === 2);
    expect('P2 plan prêt', (await status('ready').count()) === 1);
    await page.waitForSelector('[data-plan-figures="ready"]', { timeout: 20000 });
    expect('P2 trois chiffres', (await page.locator('[data-figure]').count()) === 3);
    // L'en-tête est en majuscules CSS : on vérifie les trois cellules d'écart, pas un texte.
    const gaps = await page.locator('[data-figure] span[title^="Écart"]').count();
    expect('P2 écart avec le deck de base affiché sur les trois chiffres', gaps === 3, await page.locator('[data-plan-figures="ready"]').innerText());
    await shot(page, 'side-1440-plan');

    // ─── P3 : retouche, « incomplet », rééquilibrage ───
    await copies('side', RHO, 'engaged').first().click();
    expect('P3 plan incomplet après retrait d’une entrée', (await status('incomplete').count()) === 1);
    expect('P3 aucun chiffre pour un plan incomplet', (await page.locator('[data-plan-figures="ready"]').count()) === 0 && /Plan incomplet/.test(await page.locator('[data-plan]').innerText()));
    await copies('main', MU, 'engaged').first().click();
    expect('P3 rééquilibré (−1 / +1) : prêt', (await status('ready').count()) === 1);
    await page.waitForSelector('[data-plan-figures="ready"]', { timeout: 20000 });

    // ─── P4 : note, enregistrement, chiffres persistés ───
    await page.fill('textarea[aria-label="Note du plan"]', NOTE);
    await saveBtn().click();
    await page.waitForSelector('header button:has-text("Enregistrer"):disabled', { timeout: 10000 });
    const saved = await detail();
    const matchup = saved.matchups?.[0];
    const second = matchup?.plans.find((p) => p.position === 'second');
    expect('P4 API : adversaire, plan second et note', matchup?.name === 'Kewl Tune'
      && JSON.stringify(second?.outgoing) === JSON.stringify([{ card_id: MU, copies: 1 }])
      && JSON.stringify(second?.incoming) === JSON.stringify([{ card_id: RHO, copies: 1 }])
      && second?.note === NOTE, matchup);
    expect('P4 API : starter posé sur la carte de side', saved.starters.includes(RHO), saved.starters);
    let persisted = [];
    for (let i = 0; i < 40 && !persisted.some((r) => r.matchup_id === matchup?.id && r.position === 'second'); i++) {
      await page.waitForTimeout(250);
      persisted = (await detail()).plan_summaries ?? [];
    }
    expect('P4 chiffres du plan persistés après enregistrement', persisted.some((r) => r.matchup_id === matchup?.id && r.position === 'second'), persisted);

    // ─── P5 : lien profond après rechargement ───
    await page.goto('/decks/' + id + '/side');
    await page.waitForSelector('[data-side-planner]');
    await page.getByRole('button', { name: 'Second', exact: true }).click();
    await page.waitForSelector('[data-plan-figures="ready"]', { timeout: 20000 });
    expect('P5 lien profond : plan relu (1 copie sort, 1 entre)', (await copies('main', MU, 'engaged').count()) === 1 && (await copies('side', RHO, 'engaged').count()) === 1);
    expect('P5 note relue', (await page.inputValue('textarea[aria-label="Note du plan"]')) === NOTE);

    // ─── P6 : 360 px ───
    const mobile = await launch({ width: 360, height: 780, mobile: true });
    try {
      await login(mobile.context);
      const p = mobile.page;
      await p.goto('/decks/' + id + '/side');
      await p.waitForSelector('[data-side-planner]');
      await p.waitForTimeout(300);
      ge('P6 « Échanger » ≥ 32 px', await box(p.locator('[data-swap]')), 32);
      ge('P6 une copie ≥ 32 px', await box(p.locator('[data-copy="main"]').first()), 32);
      expect('P6 vue sans débordement horizontal', await p.locator('[data-side-planner]').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      expect('P6 page sans défilement horizontal', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await shot(p, 'side-360');
    } finally {
      await mobile.browser.close();
    }
  } finally {
    // Fixture restaurée quoi qu'il arrive (side vide, aucun adversaire, starters d'origine), et
    // relue par l'API AVANT de fermer le navigateur : son contexte porte les requêtes.
    await put(original).catch((e) => expect('restauration de la fixture', false, String(e)));
    const after = await detail().catch(() => null);
    expect('fixture restaurée (side vide, aucun adversaire, starters d’origine)',
      !!after && after.cards.every((c) => c.zone !== 'side') && (after.matchups ?? []).length === 0
        && JSON.stringify([...after.starters].sort()) === JSON.stringify([...original.starters].sort()),
      after && { side: after.cards.filter((c) => c.zone === 'side'), matchups: after.matchups, starters: after.starters });
    await browser.close();
  }
  done();
}
