// Étape 9B : mode Non-engine combiné (étiquette + profil dans le même déroulant). Chaque clic est
// vérifié par l'API (/api/library) : étiquette et profil réellement posés ou retirés, dans l'ordre
// exigé par le serveur. La tuile et le bandeau annoncent l'effet du prochain clic (poser / retirer).
// Le scénario restaure la fixture de setup à l'identique (bibliothèque comparée avant / après).
import { launch, login, shot, deckId, tile, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const GAMMA = 90000003; // Combo Gamma : carte moteur, ni étiquette ni profil dans la fixture
const ZETA = 90000006; // Handtrap Zeta : Handtrap + Flexible
const KAPPA = 90000010; // Breaker Kappa : Board breaker, volontairement sans profil (Q5)

export default async function nonengine() {
  const { expect, done } = checker('Non-engine combiné (1440 px)');
  const { browser, context, page } = await launch();
  await login(context);
  const id = await deckId(context, DECK_A);

  const library = async () => (await context.request.get('/api/library')).json();
  const normalize = (lib) => JSON.stringify({
    cc: lib.cardCategories.map((x) => `${x.card_id}:${x.category_id}`).sort(),
    profiles: lib.profiles.map((p) => `${p.card_id}:${p.availability}:${p.group_id ?? ''}`).sort(),
    hopt: [...lib.hoptCardIds].sort(),
  });
  /** État d'une carte vu par l'API : noms des étiquettes (triés) et profil. */
  const stateOf = async (cardId) => {
    const lib = await library();
    const names = new Map(lib.categories.map((c) => [c.id, c.name]));
    return {
      labels: lib.cardCategories.filter((x) => x.card_id === cardId).map((x) => names.get(x.category_id)).sort(),
      profile: lib.profiles.find((p) => p.card_id === cardId)?.availability ?? null,
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
  const menuItem = (text) => page.locator('[role="menuitem"]', { hasText: text });
  const radioItem = (text) => page.locator('[role="menuitemradio"]', { hasText: text });
  const effectOf = (name) => tile(page, name).locator('[data-nonengine-effect]').getAttribute('data-nonengine-effect');
  const banner = () => page.locator('div.border-b', { hasText: 'Mode Non-engine' }).first();

  const before = normalize(await library());
  await page.goto('/decks/' + id);
  await page.waitForSelector('button[title="Starter Alpha"]');
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
  expect('fixture : Combo Gamma sans étiquette ni profil', same(await stateOf(GAMMA), { labels: [], profile: null }));

  // Couple « Handtrap » + « Précoce » : deux sélections dans le même déroulant.
  await modeBtn('Non-engine').click();
  await menuItem('Handtrap').click();
  await modeBtn('Non-engine').click();
  await radioItem('Précoce').click();
  await page.waitForTimeout(300);
  const chip = await modeBtn('Non-engine').innerText();
  expect('bouton du mode : étiquette et profil rappelés', /Handtrap/.test(chip) && /Précoce/.test(chip), chip);
  expect('tuile Combo Gamma (nue) annonce « poser »', (await effectOf('Combo Gamma')) === 'poser');
  expect('tuile Handtrap Zeta (Handtrap + Flexible) annonce « poser » : profil différent', (await effectOf('Handtrap Zeta')) === 'poser');
  expect('tuile Mulcharmy Eta (Handtrap + Précoce) annonce « retirer »', (await effectOf('Mulcharmy Eta')) === 'retirer');
  await tile(page, 'Mulcharmy Eta').hover();
  await page.waitForTimeout(150);
  expect('bandeau : « Prochain clic : retirer » sur la carte survolée', /Prochain clic : retirer/.test(await banner().innerText()), await banner().innerText());
  await tile(page, 'Combo Gamma').hover();
  await page.waitForTimeout(150);
  expect('bandeau : « Prochain clic : poser » sur la carte survolée', /Prochain clic : poser/.test(await banner().innerText()), await banner().innerText());
  await shot(page, 'nonengine-1440-avant-clic');

  // Clic 1 : pose étiquette + profil (deux requêtes, l'étiquette d'abord — sinon le serveur refuse le profil).
  await tile(page, 'Combo Gamma').click();
  let r = await apiBecomes(GAMMA, { labels: ['Handtrap'], profile: 'early' });
  expect('API après le clic : Handtrap + early posés sur Combo Gamma', r.ok, r.last);
  expect('tuile Combo Gamma annonce maintenant « retirer »', (await effectOf('Combo Gamma')) === 'retirer');
  await shot(page, 'nonengine-1440-pose');

  // Clic 2 : carte conforme → étiquette retirée, puis le profil (dernière étiquette).
  await tile(page, 'Combo Gamma').click();
  r = await apiBecomes(GAMMA, { labels: [], profile: null });
  expect('API après le second clic : étiquette et profil retirés', r.ok, r.last);
  expect('tuile Combo Gamma annonce de nouveau « poser »', (await effectOf('Combo Gamma')) === 'poser');

  // Profil différent : seul le profil change, l'étiquette est conservée ; puis restauration.
  await tile(page, 'Handtrap Zeta').click();
  r = await apiBecomes(ZETA, { labels: ['Handtrap'], profile: 'early' });
  expect('Handtrap Zeta : profil early posé, étiquette conservée', r.ok, r.last);
  await modeBtn('Non-engine').click();
  await radioItem('Flexible').click();
  await page.waitForTimeout(200);
  expect('Handtrap Zeta annonce « poser » avec le couple Handtrap + Flexible', (await effectOf('Handtrap Zeta')) === 'poser');
  await tile(page, 'Handtrap Zeta').click();
  r = await apiBecomes(ZETA, { labels: ['Handtrap'], profile: 'flexible' });
  expect('Handtrap Zeta restaurée : Handtrap + flexible', r.ok, r.last);

  // « Profil inchangé » (valeur par défaut) : étiquette seule ; Breaker Kappa garde son absence de profil (Q5).
  await modeBtn('Non-engine').click();
  await radioItem('Profil inchangé').click();
  await page.waitForTimeout(200);
  expect('Breaker Kappa (Board breaker, sans profil) annonce « poser » pour Handtrap', (await effectOf('Breaker Kappa')) === 'poser');
  await tile(page, 'Breaker Kappa').click();
  r = await apiBecomes(KAPPA, { labels: ['Board breaker', 'Handtrap'], profile: null });
  expect('Breaker Kappa : seconde étiquette posée, toujours sans profil', r.ok, r.last);
  expect('Breaker Kappa annonce « retirer »', (await effectOf('Breaker Kappa')) === 'retirer');
  await tile(page, 'Breaker Kappa').click();
  r = await apiBecomes(KAPPA, { labels: ['Board breaker'], profile: null });
  expect('Breaker Kappa : Handtrap retirée, Board breaker conservée, sans profil', r.ok, r.last);
  await shot(page, 'nonengine-1440-restauree');

  await page.click('button:has-text("Terminer")');
  expect('mode Profil toujours présent dans la barre (Q4)', (await modeBtn('Profil').count()) === 1);
  const after = normalize(await library());
  expect('bibliothèque identique à la fixture après le scénario', before === after, { before, after });
  await browser.close();
  done();
}
