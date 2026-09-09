// Étape 9, point 1 : aperçus de l'accueil recalculés avec le moteur courant, sans cache faisant
// autorité. Gardes :
//   H1 un résumé stocké d'une AUTRE version du moteur (posé par l'API avec des valeurs
//      fausses) n'est jamais affiché : l'accueil recalcule et affiche les valeurs du moteur ;
//   H2 les valeurs affichées (infobulle à 2 décimales) sont celles du panneau de l'éditeur
//      (cumulé « au moins 1 » et brick de la vue Départs théoriques, premier) ;
//   H3 le résumé recalculé est persisté (PUT /decks/:id/summary) avec une version différente
//      de la fausse, et l'accueil suivant l'affiche sans recalcul (aucun « … ») ;
//   H4 un enregistrement dans l'éditeur (résultat frais) écrit le résumé avec la configuration
//      (computedAt plus récent) ; un enregistrement pendant un recalcul ne joint rien.
import { launch, login, shot, deckId, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const FAKE_VERSION = 'obsolete-version-e2e';

export default async function home({ log }) {
  const { expect, done } = checker('accueil (aperçus)');
  const { browser, context, page } = await launch();
  await login(context);
  const id = await deckId(context, DECK_A);
  const detailOf = async () => (await context.request.get(`/api/decks/${id}`)).json();
  const listed = async () => (await (await context.request.get('/api/decks')).json()).find((d) => d.id === id);
  const card = () => page.locator('div.rounded-xl', { has: page.locator(`input[value="${DECK_A}"]`) }).first();
  const stats = async () => {
    const values = card().locator('div[data-preview] div.tnum');
    return {
      state: await card().locator('div[data-preview]').getAttribute('data-preview'),
      start: { text: await values.nth(0).innerText(), title: await values.nth(0).getAttribute('title') },
      brick: { text: await values.nth(1).innerText(), title: await values.nth(1).getAttribute('title') },
    };
  };

  // H1 : faux résumé d'une autre version, valeurs impossibles à confondre (1 % / 99 %).
  const before = await detailOf();
  const fake = { engineVersion: FAKE_VERSION, mainSize: before.cards.filter((c) => c.zone === 'main').reduce((s, c) => s + c.copies, 0), startRateFirst: 0.01, brickRate: 0.99, computedAt: '2020-01-01T00:00:00.000Z' };
  const put = await context.request.put(`/api/decks/${id}/summary`, { data: { summary: fake, expectedRevision: before.revision } });
  expect('faux résumé posé par l’API', put.ok(), put.status());
  expect('faux résumé stocké', (await listed()).summary?.engineVersion === FAKE_VERSION);

  await page.goto('/decks');
  await page.waitForSelector('text=Mes decks');
  await card().waitFor();
  const pending = await stats();
  expect('H1 : le faux résumé n’est pas affiché (état en attente ou recalculé, jamais 1 % / 99 %)', pending.start.text !== '1%' && pending.brick.text !== '99%', pending);
  await page.waitForFunction((name) => {
    const input = [...document.querySelectorAll('input')].find((i) => i.value === name);
    const el = input?.closest('div.rounded-xl')?.querySelector('div[data-preview]');
    return el?.getAttribute('data-preview') === 'ready';
  }, DECK_A, { timeout: 30000 });
  const shown = await stats();
  await shot(page, 'home-apercus');
  expect('H1 : aperçu recalculé affiché', shown.state === 'ready' && /^\d+%$/.test(shown.start.text) && /^\d+%$/.test(shown.brick.text), shown);
  expect('H1 : valeurs du moteur, pas du faux résumé', shown.start.text !== '1%' && shown.brick.text !== '99%', shown);

  // H3 : persisté avec la version courante ; l'accueil suivant l'affiche directement.
  await page.waitForTimeout(500);
  const stored = (await listed()).summary;
  expect('H3 : résumé recalculé persisté avec une autre version que la fausse', stored && stored.engineVersion !== FAKE_VERSION && /^[0-9a-f]{16}$/.test(stored.engineVersion), stored);
  expect('H3 : valeurs persistées = valeurs affichées (infobulle à 2 décimales)', stored && `${(100 * stored.startRateFirst).toFixed(2)}%` === shown.start.title && `${(100 * stored.brickRate).toFixed(2)}%` === shown.brick.title, { stored, shown });
  await page.reload();
  await card().waitFor();
  const direct = await stats();
  expect('H3 : accueil suivant sans recalcul (résumé stocké de la version courante)', direct.state === 'ready' && direct.start.title === shown.start.title, direct);

  // H2 : mêmes valeurs que le panneau de l'éditeur (Départs théoriques, premier).
  await page.goto('/decks/' + id);
  await page.waitForSelector('button[title="Starter Alpha"]');
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(300);
  const panel = page.locator('aside');
  const firstColumn = panel.locator('div.grid > div').first();
  const rows = firstColumn.locator('div.flex.flex-col > div');
  const cum1 = await rows.nth(1).locator('span.tnum').last().innerText(); // ligne « 1 », colonne cumulé = P(≥1)
  const extra = await firstColumn.innerText();
  const brick = /brick (\d+\.\d+%)/.exec(extra)?.[1];
  expect('H2 : départs ≥1 = cumulé « au moins 1 » du panneau', cum1 === shown.start.title, { cum1, shown: shown.start.title });
  expect('H2 : brick = brick du panneau', brick === shown.brick.title, { brick, shown: shown.brick.title });

  // H4 : un enregistrement avec un résultat frais écrit le résumé avec la configuration.
  const tile = page.locator('div.group', { has: page.locator('button[title="Filler Omicron"]') });
  await tile.locator('button[title="Plus de copies"]').click();
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(400);
  await tile.locator('button[title*="copies"]').first().click(); // −1 : composition initiale, deck sale
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(400);
  await page.click('button:has-text("Enregistrer")');
  await page.waitForSelector('text=/enregistré/');
  await page.waitForTimeout(300);
  const afterSave = (await listed()).summary;
  expect('H4 : résumé écrit à l’enregistrement (computedAt plus récent, même version)', afterSave && afterSave.computedAt > stored.computedAt && afterSave.engineVersion === stored.engineVersion, { afterSave, stored });
  expect('H4 : mêmes valeurs (composition inchangée)', afterSave && afterSave.startRateFirst === stored.startRateFirst && afterSave.brickRate === stored.brickRate, { afterSave, stored });

  // H4 bis : worker ralenti, enregistrement PENDANT le recalcul → aucun résumé joint (NULL).
  await page.route((u) => u.href.includes('engine.worker.ts') && u.href.includes('worker_file'), async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + `\n;{ const h = self.onmessage; self.onmessage = (e) => { const t = Date.now(); while (Date.now() - t < 3000) {} h(e); }; }\n`;
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await page.reload();
  await page.waitForSelector('button[title="Starter Alpha"]');
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 30000 });
  await tile.locator('button[title="Plus de copies"]').click();
  await page.waitForTimeout(200);
  await page.click('button:has-text("Enregistrer")'); // pendant le recalcul (3 s)
  await page.waitForSelector('text=/enregistré/', { timeout: 10000 });
  await page.waitForTimeout(200);
  expect('H4 bis : enregistrement pendant le recalcul → aucun résumé joint', (await listed()).summary === null, (await listed()).summary);
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(400);
  await tile.locator('button[title*="copies"]').first().click();
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(3600);
  await page.click('button:has-text("Enregistrer")');
  await page.waitForSelector('text=/enregistré/');
  await page.waitForTimeout(300);
  expect('H4 : composition restaurée et résumé de nouveau joint', (await listed()).summary?.startRateFirst === stored.startRateFirst);
  log(`aperçu Deck A : départs ≥1 ${shown.start.title}, brick ${shown.brick.title}, version ${stored?.engineVersion}`);
  await browser.close();
  done();
}
