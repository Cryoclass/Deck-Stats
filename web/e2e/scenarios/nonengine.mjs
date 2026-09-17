// Mode Non-engine (étape 9B, refondu en partie D des annotations par défaut) : UN seul mode, profil
// puis étiquette facultative dans le même déroulant. Chaque clic est vérifié par l'API (/api/library) :
// profil posé, adopté ou retiré, étiquette posée ou retirée. La tuile et le bandeau annoncent l'effet
// du prochain clic (poser / adopter / retirer). Les cartes synthétiques de Deck A n'ont aucun texte
// détectable : l'adoption d'un profil hérité est gardée par le scénario `defaults`. Le scénario
// restaure la fixture de setup à l'identique (bibliothèque comparée avant / après, choix compris).
import { launch, login, shot, deckId, tile, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const GAMMA = 90000003; // Combo Gamma : carte moteur, ni étiquette ni profil dans la fixture
const ZETA = 90000006; // Handtrap Zeta : Handtrap + Flexible
const KAPPA = 90000010; // Breaker Kappa : Board breaker, volontairement sans profil (Q5)

export default async function nonengine() {
  const { expect, done } = checker('Non-engine (1440 px)');
  const { browser, context, page } = await launch();
  await login(context);
  const id = await deckId(context, DECK_A);

  const library = async () => (await context.request.get('/api/library')).json();
  const normalize = (lib) => JSON.stringify({
    cc: lib.cardCategories.map((x) => `${x.card_id}:${x.category_id}`).sort(),
    profiles: lib.profiles.map((p) => `${p.card_id}:${p.availability}:${p.group_id ?? ''}`).sort(),
    hopt: [...lib.hoptCardIds].sort(),
    choices: (lib.choices ?? []).map((c) => `${c.card_id}:${c.is_hopt}:${c.nonengine_choice}`).sort(),
  });
  /** État d'une carte vu par l'API : noms des étiquettes (triés), profil et choix non-engine. */
  const stateOf = async (cardId) => {
    const lib = await library();
    const names = new Map(lib.categories.map((c) => [c.id, c.name]));
    return {
      labels: lib.cardCategories.filter((x) => x.card_id === cardId).map((x) => names.get(x.category_id)).sort(),
      profile: lib.profiles.find((p) => p.card_id === cardId)?.availability ?? null,
      chosen: (lib.choices ?? []).find((c) => c.card_id === cardId)?.nonengine_choice ?? false,
    };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** Attend (≤ 4 s) que l'API reflète l'état attendu ; renvoie le dernier état lu. */
  const apiBecomes = async (cardId, wanted) => {
    let last = null;
    for (let i = 0; i < 20; i++) {
      last = await stateOf(cardId);
      if (same(last, wanted)) return { ok: true, last };
      await page.waitForTimeout(200);
    }
    return { ok: false, last };
  };
  const modeBtn = (label) => page.locator('div.flex.shrink-0 button').filter({ hasText: label }).first();
  const choose = async (attr, value) => {
    await page.click('[data-mode-trigger="nonengine"]');
    await page.click(`[${attr}="${value}"]`);
    await page.waitForTimeout(200);
  };
  const effectOf = (name) => tile(page, name).locator('[data-nonengine-effect]').getAttribute('data-nonengine-effect');
  const banner = () => page.locator('div.border-b', { hasText: 'Mode Non-engine' }).first();

  const before = normalize(await library());
  await page.goto('/decks/' + id);
  await page.waitForSelector('button[title="Starter Alpha"]');
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
  expect('fixture : Combo Gamma sans étiquette ni profil', same(await stateOf(GAMMA), { labels: [], profile: null, chosen: false }));
  const modeLabels = await page.locator('div.flex.shrink-0 button').allInnerTexts();
  expect('un seul mode non-engine : barre des modes lue, plus de mode « Profil » séparé', modeLabels.some((t) => /Non-engine/.test(t)) && !modeLabels.some((t) => /^Profil\b/.test(t.trim())), modeLabels);

  // Profil « Précoce » + étiquette « Handtrap » : deux sélections dans le même déroulant.
  await choose('data-ne-profile', 'early');
  await choose('data-ne-label', 'Handtrap');
  const chip = await page.locator('[data-mode-trigger="nonengine"]').innerText();
  expect('bouton du mode : profil et étiquette rappelés', /Précoce/.test(chip) && /Handtrap/.test(chip), chip);
  expect('tuile Combo Gamma (nue) annonce « poser »', (await effectOf('Combo Gamma')) === 'poser');
  expect('tuile Handtrap Zeta (Handtrap + Flexible) annonce « poser » : profil différent', (await effectOf('Handtrap Zeta')) === 'poser');
  expect('tuile Mulcharmy Eta (Handtrap + Précoce, choisis) annonce « retirer »', (await effectOf('Mulcharmy Eta')) === 'retirer');
  await tile(page, 'Mulcharmy Eta').hover();
  await page.waitForTimeout(150);
  expect('bandeau : « Prochain clic : retirer » sur la carte survolée', /Prochain clic : retirer/.test(await banner().innerText()), await banner().innerText());
  await tile(page, 'Combo Gamma').hover();
  await page.waitForTimeout(150);
  expect('bandeau : « Prochain clic : poser » sur la carte survolée', /Prochain clic : poser/.test(await banner().innerText()), await banner().innerText());
  await shot(page, 'nonengine-1440-avant-clic');

  // Clic 1 : pose étiquette + profil.
  await tile(page, 'Combo Gamma').click();
  let r = await apiBecomes(GAMMA, { labels: ['Handtrap'], profile: 'early', chosen: true });
  expect('API après le clic : Handtrap + early posés sur Combo Gamma', r.ok, r.last);
  expect('tuile Combo Gamma annonce maintenant « retirer »', (await effectOf('Combo Gamma')) === 'retirer');
  await shot(page, 'nonengine-1440-pose');

  // Clic 2 : choix conforme → étiquette et profil retirés, choix explicite « pas non-engine ».
  await tile(page, 'Combo Gamma').click();
  r = await apiBecomes(GAMMA, { labels: [], profile: null, chosen: true });
  expect('API après le second clic : étiquette et profil retirés (« pas non-engine » choisi)', r.ok, r.last);
  // Retour au défaut (aspect non-engine) : la carte n'a plus aucun choix.
  const reset = await context.request.delete(`/api/library/flags/${GAMMA}?aspect=nonengine`);
  expect('retour au défaut de Combo Gamma accepté', reset.ok(), reset.status());
  r = await apiBecomes(GAMMA, { labels: [], profile: null, chosen: false });
  expect('API : Combo Gamma revenue au défaut (aucun choix)', r.ok, r.last);

  // Profil différent : seul le profil change, l'étiquette est conservée ; puis restauration.
  await page.reload();
  await page.waitForSelector('button[title="Starter Alpha"]');
  await choose('data-ne-profile', 'early');
  await choose('data-ne-label', 'Handtrap');
  await tile(page, 'Handtrap Zeta').click();
  r = await apiBecomes(ZETA, { labels: ['Handtrap'], profile: 'early', chosen: true });
  expect('Handtrap Zeta : profil early posé, étiquette conservée', r.ok, r.last);
  await choose('data-ne-profile', 'flexible');
  expect('Handtrap Zeta annonce « poser » avec Flexible + Handtrap', (await effectOf('Handtrap Zeta')) === 'poser');
  await tile(page, 'Handtrap Zeta').click();
  r = await apiBecomes(ZETA, { labels: ['Handtrap'], profile: 'flexible', chosen: true });
  expect('Handtrap Zeta restaurée : Handtrap + flexible', r.ok, r.last);

  // « Étiquette seule » : le profil n'est pas touché ; Breaker Kappa garde son absence de profil (Q5).
  await choose('data-ne-profile', 'none');
  expect('Breaker Kappa (Board breaker, sans profil) annonce « poser » pour Handtrap', (await effectOf('Breaker Kappa')) === 'poser');
  await tile(page, 'Breaker Kappa').click();
  r = await apiBecomes(KAPPA, { labels: ['Board breaker', 'Handtrap'], profile: null, chosen: false });
  expect('Breaker Kappa : seconde étiquette posée, toujours sans profil ni choix', r.ok, r.last);
  expect('Breaker Kappa annonce « retirer »', (await effectOf('Breaker Kappa')) === 'retirer');
  await tile(page, 'Breaker Kappa').click();
  r = await apiBecomes(KAPPA, { labels: ['Board breaker'], profile: null, chosen: false });
  expect('Breaker Kappa : Handtrap retirée, Board breaker conservée, sans profil', r.ok, r.last);
  await shot(page, 'nonengine-1440-restauree');

  await page.click('button:has-text("Terminer")');
  const after = normalize(await library());
  expect('bibliothèque identique à la fixture après le scénario (choix compris)', before === after, { before, after });
  await browser.close();
  done();
}
