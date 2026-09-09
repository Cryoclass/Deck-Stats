// Gardes de l'étape 6B (contrat §6 « Largeurs et cibles tactiles », Q3), portées du
// scratchpad. Chaque garde correspond à une mutation détectée en 6B :
//   M1 stepper de tuile 32 px · M2 en-tête de l'accueil sans débordement · M3 zone de
//   fichier de l'aperçu d'import lisible · M4 delta de tuile sur une ligne, non coupé ·
//   M5 bandeau de mode sans débordement · M6 delta de tuile atténué pendant le recalcul.
// Mesures à 360 px (tactile) et 1440 px ; toutes les gardes sont évaluées avant l'échec.
import { launch, login, shot, deckId, box, checker, tileOf } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const fits = (el) => el.scrollWidth <= el.clientWidth + 1;

export default async function guards() {
  for (const cfg of [{ width: 360, height: 740, mobile: true }, { width: 1440, height: 900, mobile: false }]) {
    const { expect, ge, done } = checker(`${cfg.width} px`);
    const { browser, context, page } = await launch(cfg);
    await login(context);
    const id = await deckId(context, DECK_A);

    // Accueil (M2) et aperçu d'import (M3).
    await page.goto('/decks');
    await page.waitForSelector('text=Mes decks');
    await page.waitForTimeout(300);
    expect('accueil : en-tête sans débordement (M2)', await page.locator('header').evaluate(fits));
    ge('accueil : + Nouveau deck 32 px', await box(page.locator('button:has-text("+ Nouveau deck")')), 32);
    ge('accueil : menu ⋯ d’un deck 32 px', await box(page.locator('button:has-text("⋯")').first()), 32);
    await page.click('button:has-text("+ Nouveau deck")');
    await page.waitForSelector('h2:has-text("Nouveau deck")');
    await page.waitForTimeout(200);
    expect('import : dialogue dans le viewport', await page.locator('div.max-w-lg').evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth && el.scrollWidth <= el.clientWidth + 1));
    const fileInput = await box(page.locator('input[type=file]').first());
    expect('import : zone de fichier lisible (M3)', fileInput?.w >= 190, fileInput);
    ge('import : ✕ 32 px', await box(page.locator('div.max-w-lg button[title="Fermer"]')), 32);
    const importBtn = await box(page.locator('button:has-text("Importer le texte")'));
    ge('import : bouton 32 px', importBtn, 32);
    expect('import : bouton sur une ligne', importBtn?.h <= 36, importBtn);
    await shot(page, `guards-${cfg.width}-import`);

    // Éditeur : en-tête, tuile (M1, M4), bandeau de mode (M5).
    await page.goto('/decks/' + id);
    await page.waitForSelector('button[title="Starter Alpha"]');
    // Sous 1024 px le panneau est un onglet (display:none) : on attend la durée de calcul
    // dans le DOM, visible ou non.
    await page.waitForSelector('text=/\\d+ ms/', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(400);
    expect('éditeur : en-tête sans débordement', await page.locator('header').evaluate(fits));
    ge('éditeur : Enregistrer 32 px', await box(page.locator('header button:has-text("Enregistrer")')), 32);
    ge('éditeur : sélecteur de contexte 24 px', await box(page.locator('header button:has-text("Premier")')), 24);
    const tile = tileOf(page, 'Starter Alpha');
    ge('tuile : stepper − 32 px (M1)', await box(tile.locator('button[title*="copies"]').first()), 32);
    ge('tuile : stepper + 32 px (M1)', await box(tile.locator('button[title="Plus de copies"]')), 32);
    ge('tuile : menu ⋯ 32 px', await box(tile.locator('button:has-text("⋯")')), 32);
    const delta = tile.locator('div[title^="Δ P"]');
    const deltaBox = await box(delta);
    expect('tuile : delta sur une ligne (M4)', deltaBox?.h <= 12, deltaBox);
    expect('tuile : delta non coupé (M4)', await delta.evaluate(fits), await delta.evaluate((el) => [el.scrollWidth, el.clientWidth]));
    // Étape 9 (réponse 3 de 7B) : densité de la grille mesurée — nombre de colonnes distinctes
    // (x des tuiles) ; 9 attendues à 1440 px avec des tuiles de 96 px, 3 à 360 px.
    const columns = await page.locator('div.group').evaluateAll((tiles) => new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().x))).size);
    expect(`grille : ${cfg.width === 1440 ? 9 : 3} colonnes (mesuré ${columns})`, columns === (cfg.width === 1440 ? 9 : 3), columns);
    await shot(page, `guards-${cfg.width}-annoter`);
    await page.locator('button:has-text("Condition")').first().click();
    await page.waitForTimeout(200);
    const banner = page.locator('div.border-b', { hasText: 'Mode Condition' }).first();
    expect('bandeau de mode sans débordement (M5)', await banner.evaluate(fits));
    ge('bandeau : Terminer 32 px', await box(page.locator('button:has-text("Terminer")')), 32);
    const counter = await box(page.locator('span', { hasText: 'modif.' }).first());
    expect('bandeau : compteur sur une ligne', counter?.h <= 24, counter);
    await shot(page, `guards-${cfg.width}-bandeau`);
    await page.click('button:has-text("Terminer")');
    await browser.close();
    done();
  }

  // M6 (Q3) : worker ralenti à 3 s par réécriture du script servi par Vite (le moteur,
  // le worker et le client de calcul restent intacts) ; pendant l'état périmé, la ligne
  // de delta d'une tuile est à 0,45 avec l'infobulle « version précédente », le stepper
  // reste à 1 ; tout revient à 1 après le recalcul.
  {
    const { expect, done } = checker('recalcul (M6)');
    const { browser, context, page } = await launch();
    await login(context);
    const id = await deckId(context, DECK_A);
    await page.route((u) => u.href.includes('engine.worker.ts') && u.href.includes('worker_file'), async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\n;{ const h = self.onmessage; self.onmessage = (e) => { const t = Date.now(); while (Date.now() - t < 3000) {} h(e); }; }\n`;
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
    });
    await page.goto('/decks/' + id);
    await page.waitForSelector('text=/\\d+ ms/', { timeout: 20000 });
    const tile = tileOf(page, 'Starter Alpha');
    const delta = tile.locator('div[title^="Δ P"]');
    const opacity = (l) => l.evaluate((el) => getComputedStyle(el).opacity);
    const before = await opacity(delta);
    await tileOf(page, 'Filler Omicron').locator('button[title="Plus de copies"]').click();
    await page.waitForTimeout(500);
    const during = await opacity(delta);
    const stepper = await opacity(tile.locator('button[title*="copies"]').first());
    const title = await delta.getAttribute('title');
    await shot(page, 'guards-recalcul-delta-attenue');
    await page.waitForSelector('text=/\\d+ ms/', { timeout: 20000 });
    await page.waitForTimeout(500);
    const after = await opacity(delta);
    await browser.close();
    expect('delta à 1 avant', before === '1', before);
    expect('delta atténué à 0,45 pendant le recalcul', during === '0.45', during);
    expect('stepper à 1 pendant le recalcul', stepper === '1', stepper);
    expect('infobulle « version précédente »', /version précédente/.test(title ?? ''), title);
    expect('delta à 1 après', after === '1', after);
    done();
  }
}
