// Plans de side v2, partie D (réécrit ; l'étape 10C avait une tuile par copie). Gardes (Deck A, 1440 puis 360) :
//   P1 une carte de side s'annote dans la grille (mode Starter) : tuile annotable (menu ⋯, « hors
//      calcul »), badge S posé, « non enregistré », AUCUN recalcul du deck de base ;
//   P2 onglet « Plans de side » : adversaire ajouté (il devient le deck étudié de la barre), position
//      Second par la barre, UNE tuile par carte avec son nom ; clic = +1 copie, clic droit = −1 ;
//      sélection déséquilibrée : pas d'aperçu, raison dite, « Échanger » inerte ; à une copie près,
//      chaque carte du side affiche l'écart de son entrée (S4) ; sélection équilibrée : APERÇU avec ses
//      trois chiffres et l'écart avec le plan, avant « Échanger », sans rien de « non enregistré » (S3) ;
//      « Échanger » : plan prêt, « sort ×2 » / « entre ×2 », chiffres du plan et écart avec le deck de base ;
//   P3 « Annuler l'échange » vide le plan (aucun échange), un nouvel échange −1 / +1, retrait d'une
//      carte depuis la liste « Entre » (toutes ses copies) : « incomplet », aucun chiffre ; puis remise ;
//   P4 note, enregistrement : l'API porte l'adversaire, son plan, sa note et le starter du side ;
//      les chiffres sont persistés (plan_summaries) ;
//   P5 lien profond /decks/:id/side après rechargement : plan et note relus, chiffres affichés ;
//      « Fiche imprimable » actif (rien de non enregistré) ; après une retouche, le bouton devient
//      « Enregistrer et ouvrir la fiche » et la raison est visible sans survol (D11) ; le clic enregistre
//      (API) PUIS ouvre la fiche ; un enregistrement refusé (révision périmée par l'API → 409) laisse
//      la page en place, alerte visible, rien d'ouvert ;
//   P6 à 360, 390 et 768 px : « Échanger » dans la fenêtre sans défiler (barre collante), une tuile
//      ≥ 32 px, le panneau « Probabilités » sous le plan (D12), aucun débordement horizontal ;
//   puis la fixture est restaurée (side vide, aucun adversaire, starters d'origine), vérifiée par l'API.
import { launch, login, shot, deckId, box, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const RHO = 90000017; // Side Rho : side seulement
const LAMBDA = 90000011; // Filler Lambda : 3 en main — ne peut plus entrer en side (3 copies toutes zones, S9)
const MU = 90000012; // Filler Mu : 3 en main
const OMICRON = 90000015; // Filler Omicron : 1 en main → 2 en side possibles
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
  await put({ ...original, cards: [...original.cards, { card_id: RHO, zone: 'side', copies: 3 }, { card_id: OMICRON, zone: 'side', copies: 2 }] });

  const msLabel = () => page.locator('aside span.tnum').filter({ hasText: /ms$/ }).first().innerText();
  const saveBtn = () => page.locator('header button[data-save]');
  const choice = (direction, card) => page.locator(`[data-choice="${direction}"][data-card-id="${card}"]`);
  const status = (s) => page.locator(`[data-plan-status="${s}"]`);
  const swap = () => page.locator('[data-swap]');
  const bar = () => page.locator('[data-study-bar]');

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
    await page.waitForTimeout(400);
    expect('P1 badge S posé sur Side Rho', (await rho.locator('span', { hasText: /^S$/ }).count()) >= 1);
    expect('P1 Enregistrer activé (non enregistré)', !(await saveBtn().isDisabled()));
    const ms1 = await msLabel();
    const recalc = await page.locator('text=Recalcul…').count();
    expect('P1 aucun recalcul du deck de base (durée inchangée, aucun « Recalcul… »)', ms1 === ms0 && recalc === 0, { ms0, ms1, recalc });
    await shot(page, 'side-1440-annoter');

    // ─── P2 : adversaire, tuiles par carte, sélection, aperçu, échange ───
    await page.locator('nav button[title="Plans de side"]').click();
    await page.waitForSelector('text=Aucun adversaire');
    await page.fill('input[aria-label="Nom du nouvel adversaire"]', 'Kewl Tune');
    await page.locator('[data-add-matchup]').click();
    await page.waitForSelector('[data-side-planner]');
    expect('P2 adversaire « Kewl Tune » créé et étudié (barre)', (await page.locator('[data-matchup="Kewl Tune"]').count()) === 1 && /Kewl Tune/.test(await bar().locator('select option:checked').innerText()));
    await bar().locator('button[title="Second · 5 cartes + pioche"]').click();
    await page.waitForTimeout(200);
    expect('P2 une tuile par carte, nommée : Filler Mu (main), Side Rho et Filler Omicron (side)',
      (await choice('outgoing', MU).count()) === 1 && (await choice('incoming', RHO).count()) === 1 && (await choice('incoming', OMICRON).count()) === 1
      && /Side Rho/.test(await choice('incoming', RHO).innerText()) && (await choice('incoming', LAMBDA).count()) === 0);
    await choice('outgoing', MU).locator('button').click();
    await choice('outgoing', MU).locator('button').click();
    expect('P2 clic : 2 copies sélectionnées (+2)', (await choice('outgoing', MU).getAttribute('data-state')) === 'selected' && /\+2/.test(await choice('outgoing', MU).innerText()));
    await choice('outgoing', MU).locator('button').click({ button: 'right' });
    expect('P2 clic droit : une copie de moins (+1)', /\+1/.test(await choice('outgoing', MU).innerText()));
    // À une copie près (une sortante de plus) : chaque carte du side affiche l'écart de son entrée (S4).
    await page.waitForFunction(() => document.querySelectorAll('[data-candidate-delta="ready"]').length >= 2, null, { timeout: 20000 }).catch(() => {});
    const deltas = await page.locator('[data-candidate-delta="ready"]').allInnerTexts();
    expect('P2 écarts des candidats affichés sur Side Rho et Filler Omicron', deltas.length === 2 && (await choice('incoming', RHO).locator('[data-candidate-delta]').count()) === 1, deltas);
    expect('P2 Side Rho (starter) : écart positif ; Filler Omicron (neutre) : « · »', /\+/.test(await choice('incoming', RHO).locator('[data-candidate-delta]').innerText()) && (await choice('incoming', OMICRON).locator('[data-candidate-delta]').innerText()).trim() === '·');
    expect('P2 « Échanger » inerte, raison dite (sélection déséquilibrée)', await swap().isDisabled() && /1 copie sortante pour 0 entrante/.test(await page.locator('[data-preview-reason]').innerText()));
    await choice('outgoing', MU).locator('button').click();
    await choice('incoming', RHO).locator('button').click();
    await choice('incoming', RHO).locator('button').click();
    await page.waitForSelector('[data-preview="ready"]', { timeout: 20000 });
    expect('P2 aperçu : trois chiffres et écart avec le plan, avant « Échanger »', (await page.locator('[data-preview-figure]').count()) === 3 && /aperçu/.test(await page.locator('[data-preview="ready"]').innerText()));
    expect('P2 l’aperçu ne touche pas au plan (encore vide, chiffres du deck de base)', (await page.locator('[data-plan-figures="ready"]').count()) === 1 && /Aucun échange/.test(await status('ready').innerText()));
    expect('P2 le panneau nomme l’aperçu', /aperçu · contre Kewl Tune · second/.test(await page.locator('[data-study-label="second"]').first().innerText()));
    await shot(page, 'side-1440-apercu');
    await swap().click();
    await page.waitForTimeout(200);
    expect('P2 plan prêt : « sort ×2 » / « entre ×2 », sélection vidée', (await choice('outgoing', MU).locator('[data-engaged="2"]').count()) === 1 && (await choice('incoming', RHO).locator('[data-engaged="2"]').count()) === 1 && /−0 \/ \+0/.test(await page.locator('[data-selection]').innerText()));
    expect('P2 plan prêt', (await status('ready').count()) === 1);
    await page.waitForSelector('[data-plan-figures="ready"]', { timeout: 20000 });
    expect('P2 trois chiffres du plan', (await page.locator('[data-figure]').count()) === 3);
    const gaps = await page.locator('[data-figure] span[title^="Écart"]').count();
    expect('P2 écart avec le deck de base sur les trois chiffres', gaps === 3, await page.locator('[data-plan-figures="ready"]').innerText());
    await shot(page, 'side-1440-plan');

    // ─── P3 : annuler l'échange, retouche, « incomplet », remise ───
    await page.locator('[data-undo-swap]').click();
    await page.waitForTimeout(200);
    expect('P3 « Annuler l’échange » : plus aucun échange', /Aucun échange/.test(await status('ready').innerText()) && (await page.locator('[data-undo-swap]').count()) === 0);
    await choice('outgoing', MU).locator('button').click();
    await choice('incoming', RHO).locator('button').click();
    await swap().click();
    await page.waitForTimeout(200);
    await page.locator('[data-plan-list="incoming"] button[title^="Retirer"]').click();
    await status('incomplete').waitFor({ timeout: 5000 }).catch(() => {});
    expect('P3 retrait de l’entrante (toutes ses copies) : plan incomplet, aucun chiffre', (await status('incomplete').count()) === 1 && (await page.locator('[data-plan-figures="ready"]').count()) === 0 && /incomplet/i.test(await page.locator('[data-plan]').innerText()));
    expect('P3 la barre de contexte dit la raison', /Plan second incomplet/.test(await bar().locator('[data-study-reason]').innerText()));
    // Remise : une seule entrante sélectionnée équilibre le plan ? Non — un échange est équilibré en soi.
    // On retire aussi la sortante, puis on refait l'échange −1 / +1.
    await page.locator('[data-plan-list="outgoing"] button[title^="Retirer"]').click();
    await choice('outgoing', MU).locator('button').click();
    await choice('incoming', RHO).locator('button').click();
    await swap().click();
    await page.waitForTimeout(200);
    expect('P3 rééquilibré (−1 / +1) : prêt', (await status('ready').count()) === 1);
    await page.waitForSelector('[data-plan-figures="ready"]', { timeout: 20000 });

    // ─── P4 : note, enregistrement, chiffres persistés ───
    await page.fill('textarea[aria-label="Note du plan"]', NOTE);
    expect('P4 avant enregistrement : « Enregistrer et ouvrir la fiche », raison visible', /Enregistrer et ouvrir la fiche/.test(await page.locator('[data-open-sheet]').innerText()) && /deck enregistré/.test(await page.locator('[data-open-reason]').innerText()));
    await saveBtn().click();
    await page.waitForSelector('header button[data-save]:disabled', { timeout: 10000 });
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

    // ─── P5 : lien profond après rechargement, fiche ouvrable ───
    await page.goto('/decks/' + id + '/side');
    await page.waitForSelector('[data-side-planner]');
    await bar().locator('button[title="Second · 5 cartes + pioche"]').click();
    await page.waitForSelector('[data-plan-figures="ready"]', { timeout: 20000 });
    expect('P5 lien profond : plan relu (1 sort, 1 entre)', (await choice('outgoing', MU).locator('[data-engaged="1"]').count()) === 1 && (await choice('incoming', RHO).locator('[data-engaged="1"]').count()) === 1);
    expect('P5 note relue', (await page.inputValue('textarea[aria-label="Note du plan"]')) === NOTE);
    expect('P5 rien de non enregistré : « Fiche imprimable » actif, aucune raison', (await page.locator('[data-open-sheet]').innerText()) === 'Fiche imprimable' && !(await page.locator('[data-open-sheet]').isDisabled()) && (await page.locator('[data-open-reason]').count()) === 0);
    expect('P5 chiffres du plan nommés (adversaire et position)', /Deck sidé · contre Kewl Tune · second/i.test(await page.locator('[data-plan-figures="ready"]').innerText()));
    // D11 : « Enregistrer et ouvrir la fiche » enregistre (API) puis ouvre.
    await page.fill('textarea[aria-label="Note du plan"]', NOTE + ' — v2');
    expect('P5 retouche : « Enregistrer et ouvrir la fiche », raison visible', /Enregistrer et ouvrir la fiche/.test(await page.locator('[data-open-sheet]').innerText()) && (await page.locator('[data-open-reason]').isVisible()));
    await page.locator('[data-open-sheet]').click();
    await page.waitForURL(/\/decks\/[^/]+\/side\/fiche$/, { timeout: 15000 });
    await page.waitForSelector('[data-sheet-matchup]');
    const afterOpen = await detail();
    expect('P5 fiche ouverte APRÈS enregistrement : la note v2 est en base', afterOpen.matchups?.[0]?.plans.find((p) => p.position === 'second')?.note === NOTE + ' — v2', afterOpen.matchups);
    // Enregistrement refusé : la révision est périmée par une écriture de l'API (409) → rien ne s'ouvre.
    await page.goto('/decks/' + id + '/side');
    await page.waitForSelector('[data-side-planner]');
    await page.fill('textarea[aria-label="Note du plan"]', NOTE);
    await put(configurationOf(await detail())); // révision +1 côté serveur, l'éditeur ne le sait pas
    await page.locator('[data-open-sheet]').click();
    await page.waitForSelector('header [role="alert"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    expect('P5 enregistrement refusé : la page reste sur l’onglet, alerte visible, bouton inchangé', new URL(page.url()).pathname.endsWith('/side') && (await page.locator('[data-sheet-matchup]').count()) === 0 && /Enregistrer et ouvrir la fiche/.test(await page.locator('[data-open-sheet]').innerText()), { url: page.url(), alert: await page.locator('header [role="alert"]').innerText() });
    expect('P5 refusé : la note v2 est toujours celle de la base', (await detail()).matchups?.[0]?.plans.find((p) => p.position === 'second')?.note === NOTE + ' — v2');

    // ─── P6 : 360, 390 et 768 px (sous 1024 px : barre collante, panneau sous le plan) ───
    // Un seul navigateur mobile redimensionné (une connexion : le serveur limite le login à 10 par minute).
    const mobile = await launch({ width: 360, height: 780, mobile: true });
    try {
      await login(mobile.context);
      const p = mobile.page;
      for (const [w, h] of [[360, 780], [390, 844], [768, 1024]]) {
        await p.setViewportSize({ width: w, height: h });
        await p.goto('/decks/' + id + '/side');
        await p.waitForSelector('[data-side-planner]');
        await p.waitForTimeout(400);
        ge(`P6 ${w} px : « Échanger » ≥ 32 px`, await box(p.locator('[data-swap]')), 32);
        ge(`P6 ${w} px : une tuile ≥ 32 px`, await box(p.locator('[data-choice="outgoing"]').first()), 32);
        const swapBox = await p.locator('[data-swap]').boundingBox();
        expect(`P6 ${w} px : « Échanger » dans la fenêtre sans défiler (barre collante)`, !!swapBox && swapBox.y + swapBox.height <= h + 0.5, swapBox);
        expect(`P6 ${w} px : panneau « Probabilités » sous le plan`, (await p.locator('[data-side-panel] [data-study-column="second"]').count()) === 1);
        expect(`P6 ${w} px : vue sans débordement horizontal`, await p.locator('[data-side-planner]').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        expect(`P6 ${w} px : page sans défilement horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        await shot(p, `side-${w}`);
      }
    } finally {
      await mobile.browser.close();
    }
  } finally {
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
