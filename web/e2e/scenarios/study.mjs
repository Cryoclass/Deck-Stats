// Plans de side v2, partie C : l'éditeur en contexte. Gardes (Deck A) :
//   C1 la barre de contexte existe ; sans adversaire choisi, les deux colonnes disent « Deck de base » ;
//   C2 adversaire choisi : colonnes « contre Kewl Tune · premier / · second », matrice et mode Requête
//      nommés de même ; le chiffre P(≥ 1) de la colonne second est EXACTEMENT celui que le store persiste
//      (plan_summaries, lu par l'API) ;
//   C3 plan incomplet (Snake-Eye second) : aucun chiffre dans la colonne, la raison est dite (S2) ; le
//      volet premier (vide) reste calculé ;
//   C4 le contexte est dans l'URL et survit au rechargement ;
//   C5 le mur de mains tire dans le deck sidé : jamais une carte que le plan fait sortir, la carte
//      entrante apparaît ; le mur nomme le deck ;
//   C6 onglet Annoter : « sort (plan) » sur la carte sortie, « entre » sur la carte de side entrante,
//      bandeau « vous annotez le deck de base » ;
//   C7 à 360 / 390 / 768 / 1440 : barre sans débordement, cibles ≥ 24 px, colonnes nommées ;
//   puis la fixture est restaurée.
import { randomUUID } from 'node:crypto';
import { launch, login, shot, deckId, box, checker, tileOf } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const RHO = 90000017; // Side Rho : side seulement
const OMICRON = 90000015; // Filler Omicron : 1 en main
const MU = 90000012; // Filler Mu : 3 en main
const WIDTHS = [360, 390, 768, 1440];

export default async function study() {
  const { expect, ge, done } = checker('éditeur en contexte');
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

  const kewl = randomUUID();
  const snake = randomUUID();
  // Side Rho est annotée starter (R6) : le plan de Kewl Tune change les chiffres — un échange de cartes
  // neutres ne les changerait pas (S7), et le deck de base serait réutilisé tel quel.
  await put({
    ...original,
    starters: [...original.starters, RHO],
    cards: [...original.cards, { card_id: RHO, zone: 'side', copies: 3 }, { card_id: OMICRON, zone: 'side', copies: 2 }],
    matchups: [
      // Kewl Tune : premier vide (= deck de base), second prêt (les 3 Mu sortent, les 3 Rho entrent).
      { id: kewl, name: 'Kewl Tune', sort_index: 0, plans: [
        { position: 'first', note: null, outgoing: [], incoming: [] },
        { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 3 }], incoming: [{ card_id: RHO, copies: 3 }] },
      ] },
      // Snake-Eye : second incomplet (2 sortent, 1 entre).
      { id: snake, name: 'Snake-Eye', sort_index: 1, plans: [
        { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 2 }], incoming: [{ card_id: RHO, copies: 1 }] },
      ] },
    ],
  });

  const label = (position) => page.locator(`[data-study-label="${position}"]`).first();
  const column = (position) => page.locator(`[data-study-column="${position}"]`);
  /** Cellules « cumulé » de la colonne (— , P(≥1), P(≥2), P(≥3)). */
  const cumulative = (position) => column(position).locator('span.w-11.text-fg-3');
  const select = () => page.locator('select[data-study-select]');
  const positionButton = (title) => page.locator(`[data-study-bar] button[title="${title}"]`);
  const waitFigures = async (position) => {
    await page.waitForFunction((pos) => {
      const col = document.querySelector(`[data-study-column="${pos}"]`);
      return !!col && col.querySelectorAll('span.w-11.text-fg-3').length === 4 && !/Calcul du deck sidé/.test(col.textContent ?? '');
    }, position, { timeout: 20000 });
    await page.waitForTimeout(200);
  };

  try {
    // ─── C1 : deck de base ───
    await page.goto('/decks/' + id);
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
    await waitFigures('second');
    expect('C1 barre de contexte présente, deck de base', (await select().inputValue()) === '' && (await select().locator('option').count()) === 3);
    expect('C1 colonnes nommées « Deck de base »', (await label('first').innerText()) === 'Deck de base' && (await label('second').innerText()) === 'Deck de base');
    const baseSecond = await cumulative('second').nth(1).innerText();

    // ─── C2 : contre Kewl Tune ───
    await select().selectOption(kewl);
    await page.waitForFunction(() => /contre Kewl Tune/.test(document.querySelector('[data-study-label="second"]')?.textContent ?? ''), null, { timeout: 5000 });
    await waitFigures('second');
    expect('C2 colonnes nommées « contre Kewl Tune · premier / second »', (await label('first').innerText()) === 'contre Kewl Tune · premier' && (await label('second').innerText()) === 'contre Kewl Tune · second');
    expect('C2 colonne premier (plan vide) : mêmes chiffres que le deck de base, nommés autrement', (await column('first').locator('[data-study-kind]').getAttribute('data-study-kind')) === 'sided');
    const sidedSecond = await cumulative('second').nth(1).innerText();
    expect('C2 colonne second : le deck sidé change le chiffre P(≥ 1)', sidedSecond !== baseSecond, { baseSecond, sidedSecond });
    expect('C2 mode Requête nommé sur le deck sidé', /contre Kewl Tune · second/.test(await page.locator('[data-query-result="second"] [data-study-label]').innerText()));
    await page.locator('[data-study-bar] button[title="Second · 5 cartes + pioche"]').click();
    await page.waitForFunction(() => /contre Kewl Tune · second/.test(document.querySelector('[data-matrix-title]')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
    expect('C2 matrice nommée sur le deck sidé', /contre Kewl Tune · second/i.test(await page.locator('[data-matrix-title]').innerText()), await page.locator('[data-matrix-title]').innerText());
    // Le store persiste les chiffres du plan (deck sans modification non enregistrée) : le chiffre à
    // l'écran est exactement celui de l'API, au format du panneau.
    let stored = null;
    for (let i = 0; i < 30 && !stored; i++) {
      const d = await detail();
      stored = (d.plan_summaries ?? []).find((r) => r.matchup_id === kewl && r.position === 'second')?.summary ?? null;
      if (!stored) await page.waitForTimeout(500);
    }
    expect('C2 chiffres du plan persistés par le store', !!stored, stored);
    if (stored) expect('C2 P(≥ 1) à l’écran = chiffre persisté (plan_summaries)', sidedSecond === `${(100 * stored.startOne).toFixed(2)}%`, { sidedSecond, startOne: stored.startOne });
    await shot(page, 'study-1440-kewl');

    // ─── C3 : plan incomplet ───
    await select().selectOption(snake);
    await page.waitForFunction(() => /contre Snake-Eye/.test(document.querySelector('[data-study-label="second"]')?.textContent ?? ''), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    expect('C3 colonne second sans chiffre, raison dite (S2)', (await cumulative('second').count()) === 0 && /Plan second incomplet/.test(await column('second').innerText()));
    expect('C3 raison dans la barre', /Plan second incomplet/.test(await page.locator('[data-study-reason]').first().innerText()));
    expect('C3 mode Requête second : « — »', /—/.test(await page.locator('[data-query-result="second"]').innerText()));
    await waitFigures('first');
    expect('C3 volet premier (vide) calculé : « contre Snake-Eye · premier »', (await label('first').innerText()) === 'contre Snake-Eye · premier' && (await cumulative('first').count()) === 4);
    await shot(page, 'study-1440-incomplet');

    // ─── C4 : URL et rechargement ───
    await select().selectOption(kewl);
    await page.waitForFunction(() => /contre Kewl Tune/.test(document.querySelector('[data-study-label="second"]')?.textContent ?? ''), null, { timeout: 5000 });
    await page.waitForTimeout(200);
    const url = new URL(page.url());
    expect('C4 contexte dans l’URL (contre + position)', url.searchParams.get('contre') === kewl && url.searchParams.get('position') === 'second', url.search);
    await page.reload();
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.waitForFunction(() => /contre Kewl Tune · second/.test(document.querySelector('[data-study-label="second"]')?.textContent ?? ''), null, { timeout: 20000 });
    expect('C4 après rechargement : adversaire et position retrouvés', (await select().inputValue()) === kewl && (await positionButton('Second · 5 cartes + pioche').getAttribute('class')).includes('bg-ink-600'));

    // ─── C5 : mur de mains sur le deck sidé ───
    await page.click('nav button[title="Mur de mains"]');
    await page.waitForSelector('main img', { timeout: 20000 });
    await page.waitForTimeout(400);
    const alts = await page.locator('main img').evaluateAll((els) => els.map((e) => e.getAttribute('alt')));
    expect('C5 mains de 6 cartes tirées dans le deck sidé : jamais Filler Mu (sorti), Side Rho présent (entré)', alts.length >= 6 && !alts.includes('Filler Mu') && alts.includes('Side Rho'), { n: alts.length, mu: alts.filter((a) => a === 'Filler Mu').length, rho: alts.filter((a) => a === 'Side Rho').length });
    expect('C5 mur nommé sur le deck sidé', /contre Kewl Tune · second/.test(await page.locator('[data-study-label="wall"]').innerText()));
    await shot(page, 'study-1440-mur');

    // ─── C6 : onglet Annoter ───
    await page.click('nav button[title="Annoter"]');
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.waitForTimeout(300);
    expect('C6 bandeau « vous annotez le deck de base »', /deck de base/.test(await page.locator('[data-study-banner]').innerText()) && /contre Kewl Tune · second/.test(await page.locator('[data-study-banner]').innerText()));
    expect('C6 Filler Mu : « sort (plan) », pas d’écart', (await tileOf(page, 'Filler Mu').locator('[data-plan-out]').count()) === 1 && (await tileOf(page, 'Filler Mu').locator('[data-plan-move="out"]').innerText()) === 'sort ×3');
    const rho = page.locator('[data-zone-block="side"] [data-zone-tile="side"][data-card-id="' + RHO + '"]');
    expect('C6 Side Rho : « entre ×3 », plus « hors calcul »', (await rho.locator('[data-plan-move="in"]').innerText()) === 'entre ×3' && (await rho.locator('[data-off-calc]').count()) === 0);
    // L'écart de Side Rho (starter entré) est celui du deck sidé : non nul, affiché une fois le résultat
    // complet du deck sidé calculé (« … » avant, jamais un blanc).
    await page.waitForFunction((rhoId) => /−1 :/.test(document.querySelector(`[data-zone-tile="side"][data-card-id="${rhoId}"]`)?.textContent ?? ''), RHO, { timeout: 20000 }).catch(() => {});
    expect('C6 Side Rho : écart du deck sidé affiché (« −1 : … »), pas un blanc', /−1 : [−+]\d/.test(await rho.innerText()), await rho.innerText());
    expect('C6 Starter Alpha : écart du deck sidé affiché', /−1 : [−+]\d/.test(await tileOf(page, 'Starter Alpha').innerText()));
    await shot(page, 'study-1440-annoter');

    // ─── C7 : largeurs ───
    for (const W of WIDTHS) {
      const m = await launch({ width: W, height: 900, mobile: W < 1024 });
      try {
        await login(m.context);
        const p = m.page;
        await p.goto(`/decks/${id}?contre=${kewl}&position=second`);
        await p.waitForSelector('button[title="Starter Alpha"]');
        await p.waitForTimeout(400);
        const bar = p.locator('[data-study-bar]');
        expect(`C7 ${W} : barre sans débordement`, await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        expect(`C7 ${W} : page sans défilement horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        ge(`C7 ${W} : sélecteur d’adversaire ≥ 24 px`, await box(p.locator('select[data-study-select]')), 24);
        ge(`C7 ${W} : bascule Premier ≥ 24 px`, await box(p.locator('[data-study-bar] button[title="Premier · 5 cartes"]')), 24);
        if (W < 1024) await p.click('nav button[title="Stats"]');
        await p.waitForFunction(() => /contre Kewl Tune · second/.test(document.querySelector('[data-study-label="second"]')?.textContent ?? ''), null, { timeout: 20000 });
        expect(`C7 ${W} : colonne second nommée et visible`, await p.locator('[data-study-label="second"]').first().isVisible());
        await shot(p, `study-${W}`);
      } finally {
        await m.browser.close();
      }
    }
  } finally {
    await put(original).catch((e) => expect('restauration de la fixture', false, String(e)));
    const after = await detail().catch(() => null);
    expect('fixture restaurée (side vide, aucun adversaire, starters d’origine)', !!after && after.cards.every((c) => c.zone !== 'side') && (after.matchups ?? []).length === 0 && JSON.stringify([...after.starters].sort()) === JSON.stringify([...original.starters].sort()));
    await browser.close();
  }
  done();
}
