// Étape 9C : extra et side éditables. Gardes (Deck A, 1440 px puis mesures à 360 px) :
//   Z1 bloc « Side deck » présent et vide, « + Ajouter » à 32 px, dialogue ouvert SUR la zone ;
//   Z2 carte ajoutée en side : tuile ≥ 80 px, stepper à 32 px, Enregistrer activé (« non
//      enregistré »), grille du main inchangée et AUCUN recalcul (durée de calcul du panneau
//      inchangée, aucun « Recalcul… ») ;
//   Z3 stepper + / − puis retrait à 0 copie : toast nommant le side, « Annuler » restaure la
//      tuile dans le side, toujours sans recalcul ;
//   Z4 enregistrement : l'API porte la carte en side (main 40 intact, révision +1) et l'aperçu
//      joint (le résultat est resté frais) ; rechargement : la tuile side est là, rien à
//      enregistrer ;
//   Z5 à 360 px : stepper de la tuile side à 32 px, section sans débordement ;
//   puis la fixture est restaurée (side vide, main 40, vérifié par l'API).
import { launch, login, shot, deckId, box, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const RHO = 90000017; // Side Rho : jamais dans le main de la fixture

export default async function extraside() {
  const { expect, ge, done } = checker('extra / side');
  const { browser, context, page } = await launch();
  await login(context);
  const id = await deckId(context, DECK_A);
  const detail = async () => (await context.request.get(`/api/decks/${id}`)).json();
  const listed = async () => (await (await context.request.get('/api/decks')).json()).find((d) => d.id === id);
  const sideOf = (d) => d.cards.filter((c) => c.zone === 'side').map((c) => [c.card_id, c.copies]);
  const mainCount = (d) => d.cards.filter((c) => c.zone === 'main').reduce((s, c) => s + c.copies, 0);
  const fits = (el) => el.scrollWidth <= el.clientWidth + 1;

  const before = await detail();
  expect('fixture : side vide, main 40', sideOf(before).length === 0 && mainCount(before) === 40, { side: sideOf(before), main: mainCount(before) });
  const startedAt = Date.now();

  const open = async () => {
    await page.goto('/decks/' + id);
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(300);
  };
  const msLabel = () => page.locator('aside span.tnum').filter({ hasText: /ms$/ }).first().innerText();
  const saveBtn = () => page.locator('header button:has-text("Enregistrer")');
  const sideBlock = () => page.locator('[data-zone-block="side"]');
  const rhoTile = () => sideBlock().locator(`[data-zone-tile="side"][data-card-id="${RHO}"]`);
  const mainTiles = () => page.locator('div.group').filter({ has: page.locator('div[title^="Δ P"]') });
  const noRecompute = async (label, ms0) => {
    await page.waitForTimeout(400); // > délai de regroupement (50 ms) + calcul du deck A
    const ms = await msLabel();
    const recalc = await page.locator('text=Recalcul…').count();
    expect(`${label} : aucun recalcul (durée inchangée, aucun « Recalcul… »)`, ms === ms0 && recalc === 0, { ms0, ms, recalc });
  };

  // ─── Z1 : bloc side vide, + Ajouter 32 px, dialogue sur la zone ───
  await open();
  const ms0 = await msLabel();
  expect('avant : Enregistrer désactivé', await saveBtn().isDisabled());
  expect('Z1 bloc side présent et vide', (await sideBlock().count()) === 1 && (await sideBlock().locator('[data-zone-tile]').count()) === 0);
  expect('Z1 bloc extra présent et vide', (await page.locator('[data-zone-block="extra"] [data-zone-tile]').count()) === 0);
  ge('Z1 + Ajouter (side) 32 px', await box(sideBlock().locator('[data-zone-add="side"]')), 32);
  await sideBlock().locator('[data-zone-add="side"]').click();
  await page.waitForSelector('[data-add-zone="side"]');
  expect('Z1 dialogue ouvert sur le side deck', /side deck/.test(await page.locator('[data-add-zone="side"]').innerText()));
  await page.fill('input[placeholder="Nom de carte ou passcode…"]', 'Side Rho');
  await page.waitForSelector('li button:has-text("Side Rho")');
  await page.locator('li button:has-text("Side Rho")').click();
  await page.waitForTimeout(200);
  expect('Z1 compteur du dialogue : side : 1', (await page.locator('span.tnum', { hasText: 'side :' }).innerText()).trim() === 'side : 1');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-add-zone="side"]', { state: 'detached' });

  // ─── Z2 : tuile side, non enregistré, main inchangé, aucun recalcul ───
  expect('Z2 tuile Side Rho dans le bloc side', (await rhoTile().count()) === 1);
  const tb = await box(rhoTile());
  expect('Z2 tuile side ≥ 80 px de large', tb?.w >= 80, tb);
  ge('Z2 stepper − 32 px', await box(rhoTile().locator('button[title*="copie"]').first()), 32);
  ge('Z2 stepper + 32 px', await box(rhoTile().locator('button[title="Plus de copies"]')), 32);
  expect('Z2 compteur du bloc side : 1', (await sideBlock().locator('[data-zone-count="side"]').innerText()).trim() === '1');
  expect('Z2 Enregistrer activé (non enregistré)', !(await saveBtn().isDisabled()));
  expect('Z2 grille du main inchangée (15 identités)', (await mainTiles().count()) === 15, await mainTiles().count());
  await noRecompute('Z2', ms0);
  await shot(page, 'extraside-1440-ajout');

  // ─── Z3 : stepper puis retrait à 0 copie, toast du side, annulation dans le side ───
  await rhoTile().locator('button[title="Plus de copies"]').click();
  expect('Z3 stepper + : 2 copies', (await rhoTile().locator('span.tnum').innerText()).trim() === '2');
  await rhoTile().locator('button[title="Moins de copies"]').click();
  expect('Z3 stepper − : 1 copie', (await rhoTile().locator('span.tnum').innerText()).trim() === '1');
  await rhoTile().locator('button[title^="Retirer du side"]').click();
  await page.waitForSelector('[data-removal-zone="side"]');
  expect('Z3 tuile retirée du side', (await rhoTile().count()) === 0);
  const toast = await page.locator('[data-removal-zone="side"]').innerText();
  expect('Z3 toast : « Retirée du side deck : Side Rho »', /Retirée du side deck\s*:\s*Side Rho/.test(toast), toast);
  await shot(page, 'extraside-1440-toast');
  await page.locator('[data-removal-zone="side"] button:has-text("Annuler")').click();
  await page.waitForSelector('[data-removal-zone="side"]', { state: 'detached' });
  expect('Z3 Annuler : tuile restaurée dans le side, 1 copie', (await rhoTile().count()) === 1 && (await rhoTile().locator('span.tnum').innerText()).trim() === '1');
  expect('Z3 main toujours inchangé', (await mainTiles().count()) === 15);
  await noRecompute('Z3', ms0);

  // ─── Z4 : enregistrement, API, aperçu joint, rechargement ───
  await page.click('header button:has-text("Enregistrer")');
  await page.waitForSelector('text=/enregistré/');
  await page.waitForTimeout(400);
  const saved = await detail();
  expect('Z4 API : side = [Side Rho ×1]', JSON.stringify(sideOf(saved)) === JSON.stringify([[RHO, 1]]), sideOf(saved));
  expect('Z4 API : main 40 intact, révision +1', mainCount(saved) === 40 && saved.revision === before.revision + 1, { main: mainCount(saved), revision: saved.revision, before: before.revision });
  const summary = (await listed()).summary;
  expect('Z4 aperçu joint à l’enregistrement (résultat resté frais malgré la mutation side)', summary && summary.mainSize === 40 && Date.parse(summary.computedAt) >= startedAt - 60000, summary);
  await page.reload();
  await page.waitForSelector('button[title="Starter Alpha"]');
  await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
  await page.waitForTimeout(300);
  expect('Z4 rechargement : tuile side présente, 1 copie', (await rhoTile().count()) === 1 && (await rhoTile().locator('span.tnum').innerText()).trim() === '1');
  expect('Z4 rechargement : rien à enregistrer', await saveBtn().isDisabled());
  await shot(page, 'extraside-1440-recharge');
  await browser.close();

  // ─── Z5 : 360 px, puis restauration de la fixture ───
  {
    const m = await launch({ width: 360, height: 740, mobile: true });
    await login(m.context);
    const p = m.page;
    await p.goto('/decks/' + id);
    await p.waitForSelector('button[title="Starter Alpha"]');
    await p.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
    await p.waitForTimeout(300);
    const block = p.locator('[data-zone-block="side"]');
    const tile = block.locator(`[data-zone-tile="side"][data-card-id="${RHO}"]`);
    await tile.scrollIntoViewIfNeeded();
    ge('Z5 360 px : stepper − 32 px', await box(tile.locator('button[title*="copie"]').first()), 32);
    ge('Z5 360 px : stepper + 32 px', await box(tile.locator('button[title="Plus de copies"]')), 32);
    ge('Z5 360 px : + Ajouter (side) 32 px', await box(block.locator('[data-zone-add="side"]')), 32);
    expect('Z5 360 px : section extra / side sans débordement', await p.locator('[data-zone-section]').evaluate(fits));
    expect('Z5 360 px : body sans défilement horizontal', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(p, 'extraside-360');
    // Restauration : retrait à 0 copie, toast fermé, enregistrement.
    await tile.locator('button[title^="Retirer du side"]').click();
    await p.waitForSelector('[data-removal-zone="side"]');
    await p.locator('[data-removal-zone="side"] button[title="Fermer"]').click();
    await p.click('header button:has-text("Enregistrer")');
    await p.waitForSelector('text=/enregistré/');
    await p.waitForTimeout(400);
    const restored = await (await m.context.request.get(`/api/decks/${id}`)).json();
    expect('fixture restaurée : side vide, main 40', sideOf(restored).length === 0 && mainCount(restored) === 40, { side: sideOf(restored), main: mainCount(restored) });
    await m.browser.close();
  }
  done();
}
