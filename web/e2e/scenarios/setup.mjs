// Fixture commune : deux decks annotés par les gestes de l'interface (portée du script
// de préparation 6B). « Deck A » = référence (40 cartes, 15 identités) ; « Deck B » =
// variante (une copie de Starter Alpha remplacée par un Filler Omicron). Les annotations
// du compte (HOPT, étiquettes, profils, plafond partagé) ne sont posées qu'une fois ;
// starters, combo et condition sont locaux à chaque deck. Breaker Kappa reste étiquetée
// SANS profil (Q5) : avertissement du panneau et du comparateur.
import { launch, login, shot, tile, tileOf } from '../lib.mjs';

export const DECK_A = 'Deck A';
export const DECK_B = 'Deck B';

const LINES_A = [
  '3x 90000001', '3x 90000002', '3x 90000003', '3x 90000004', '3x 90000005', '3x 90000006',
  '3x 90000007', '3x 90000008', '2x 90000009', '2x 90000010', '3x 90000011', '3x 90000012',
  '3x 90000013', '2x 90000014', '1x 90000015',
];
const LINES_B = LINES_A.map((l) => (l === '3x 90000001' ? '2x 90000001' : l === '1x 90000015' ? '2x 90000015' : l));

export default async function setup() {
  const { browser, context, page } = await launch();
  await login(context);
  const done = async () => { await page.click('button:has-text("Terminer")'); };
  const modeBtn = (label) => page.locator('div.flex.shrink-0 button').filter({ hasText: label }).first();
  const menuItem = (text) => page.locator('[role="menuitem"]', { hasText: text });

  const importDeck = async (name, lines) => {
    await page.goto('/decks');
    await page.waitForSelector('text=Mes decks');
    await page.click('button:has-text("+ Nouveau deck")');
    await page.fill('input[placeholder="ex. Ryzeal going second"]', name);
    await page.fill('textarea', lines.join('\n'));
    await page.click('button:has-text("Importer le texte")');
    await page.waitForURL(/\/decks\/[0-9a-f-]+/);
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.waitForTimeout(600);
  };

  /** Annotations LOCALES au deck : starters, combo, condition. */
  const annotateLocal = async () => {
    await modeBtn('Starter').click();
    await tile(page, 'Starter Alpha').click();
    await tile(page, 'Starter Beta').click();
    await done();
    await modeBtn('Lier combo').click();
    await tile(page, 'Combo Gamma').click();
    await tile(page, 'Combo Delta').click();
    await done();
    await modeBtn('Condition').click();
    await tile(page, 'Starter Alpha').click();
    await tile(page, 'Target Xi').click();
    await page.waitForTimeout(300);
    await done();
  };

  const save = async () => {
    await page.waitForTimeout(600);
    await page.click('button:has-text("Enregistrer")');
    await page.waitForSelector('text=/enregistré/');
    await page.waitForTimeout(600);
  };

  // ─── Deck A + annotations du compte ───
  await importDeck(DECK_A, LINES_A);
  await shot(page, 'setup-deck-a-initial');
  await annotateLocal();

  await modeBtn('HOPT').click();
  await tile(page, 'Handtrap Epsilon').click();
  await page.waitForTimeout(300);
  await done();

  await modeBtn('Non-engine').click();
  await menuItem('Handtrap').click();
  for (const n of ['Handtrap Epsilon', 'Handtrap Zeta', 'Mulcharmy Eta', 'Mulcharmy Theta', 'Quick-Play Iota']) {
    await tile(page, n).click();
    await page.waitForTimeout(150);
  }
  await modeBtn('Non-engine').click();
  await menuItem('Board breaker').click();
  await tile(page, 'Breaker Kappa').click();
  await page.waitForTimeout(300);
  await done();

  await modeBtn('Profil').click();
  await menuItem('Flexible').click();
  await tile(page, 'Handtrap Epsilon').click();
  await tile(page, 'Handtrap Zeta').click();
  await modeBtn('Profil').click();
  await menuItem('Précoce').click();
  await tile(page, 'Mulcharmy Eta').click();
  await tile(page, 'Mulcharmy Theta').click();
  await modeBtn('Profil').click();
  await menuItem('Préparée').click();
  await tile(page, 'Quick-Play Iota').click();
  await page.waitForTimeout(400);
  await done();
  // Breaker Kappa : étiquetée, volontairement sans profil.

  // Plafond partagé « Mulcharmy », 1 par tour, sur les deux Mulcharmy (menu ⋯).
  await page.click('nav button:has-text("Combos")');
  const capName = page.locator('input[placeholder^="Nouveau plafond"]');
  await capName.waitFor();
  await capName.fill('Mulcharmy');
  await capName.locator('..').locator('input[type="number"]').fill('1');
  await capName.locator('..').locator('button', { hasText: '+' }).click();
  await page.waitForSelector('li:has-text("Mulcharmy")');
  await page.click('nav button:has-text("Annoter")');
  await page.waitForSelector('button[title="Starter Alpha"]');
  for (const n of ['Mulcharmy Eta', 'Mulcharmy Theta']) {
    await tileOf(page, n).locator('button:has-text("⋯")').click();
    await page.waitForSelector('[role="menu"]');
    await menuItem('/tour').click();
    await page.waitForTimeout(500);
  }
  await save();
  await shot(page, 'setup-deck-a-annote');

  // ─── Deck B : variante, annotations locales seulement ───
  await importDeck(DECK_B, LINES_B);
  await annotateLocal();
  await save();
  await shot(page, 'setup-deck-b-annote');

  // Contrôle de la fixture par l'API : profils, plafond et carte sans profil.
  const lib = await (await context.request.get('/api/library')).json();
  const profiles = new Map(lib.profiles.map((p) => [p.card_id, p]));
  const problems = [];
  if (!lib.groups.some((g) => g.name === 'Mulcharmy' && g.cap_per_turn === 1)) problems.push('plafond Mulcharmy absent');
  for (const id of [90000007, 90000008]) if (!profiles.get(id)?.group_id) problems.push(`plafond non posé sur ${id}`);
  if (profiles.has(90000010)) problems.push('Breaker Kappa devrait rester sans profil');
  if (!lib.hoptCardIds.includes(90000005)) problems.push('HOPT absent');
  const decks = await (await context.request.get('/api/decks')).json();
  for (const [name, size] of [[DECK_A, 40], [DECK_B, 40]]) {
    const d = decks.find((x) => x.name === name);
    if (!d) problems.push(`${name} absent`);
    else if (d.main_count !== size) problems.push(`${name} : ${d.main_count} cartes au lieu de ${size}`);
  }
  await browser.close();
  if (problems.length) throw new Error(`fixture incomplète : ${problems.join(' ; ')}`);
}
