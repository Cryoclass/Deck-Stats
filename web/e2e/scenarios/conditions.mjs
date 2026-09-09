// Étape 9 (réponse 3 de 7B, report 6B) : mise en page d'un arbre ET/OU PLUS PROFOND que
// « ET de clauses, OU de feuilles ». L'éditeur de l'Inventaire produit « ET > OU > OU » par
// « ou… » sur une feuille déjà membre d'un groupe OU ; on construit ici, par les gestes de
// l'interface, l'arbre : Target Xi OU (Combo Delta OU Starter Beta) … puis ET Handtrap Zeta,
// puis (Xi OU (Delta OU Beta)) ET (Zeta OU Mulcharmy Eta), à 1440 et 360 px. Gardes : arbre
// rendu en profondeur (groupes imbriqués), aucun débordement de l'éditeur ni du corps de page,
// sélecteurs ≥ 24 px, chaque feuille avec son « ✕ » ; capture pour la relecture. Rien n'est
// enregistré (le navigateur est fermé avec le deck sale, fixture intacte).
import { launch, login, shot, deckId, box, checker } from '../lib.mjs';
import { DECK_A } from './setup.mjs';

const fits = (el) => el.scrollWidth <= el.clientWidth + 1;
const noBodyScroll = () => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1;

export default async function conditions({ log }) {
  const failures = [];
  for (const cfg of [{ width: 1440, height: 900, mobile: false }, { width: 360, height: 740, mobile: true }]) {
    const W = cfg.width;
    const { expect, ge, failures: local } = checker(`${W} px`);
    const { browser, context, page } = await launch(cfg);
    await login(context);
    const id = await deckId(context, DECK_A);
    await page.goto('/decks/' + id);
    await page.waitForSelector('button[title="Starter Alpha"]');
    await page.click('nav button:has-text("Inventaire")');
    const section = page.locator('div.border-b', { hasText: 'Starters conditionnels' }).first();
    await section.waitFor();
    const item = section.locator('li', { hasText: 'Starter Alpha' }).first();
    const editor = item.locator(':scope > div.mt-1 > div').first(); // racine de ConditionEditor
    // Feuille par son libellé EXACT « ▤ nom » : `hasText` sur la feuille entière matcherait
    // aussi les options de son sélecteur (toutes les cartes du main).
    const leafOf = (name) => editor.locator('span.border-dashed', { has: page.locator('span', { hasText: new RegExp(`^▤ ${name}$`) }) }).first();
    const pick = async (select, name) => {
      await select.selectOption({ label: name });
      await page.waitForTimeout(250);
    };
    expect('condition initiale : une feuille Target Xi', (await leafOf('Target Xi').count()) === 1);

    // Xi OU Delta, puis (Xi OU (Delta OU Beta)) : « ou… » sur une feuille déjà dans un groupe OU.
    await pick(leafOf('Target Xi').locator('select'), 'Combo Delta');
    await pick(leafOf('Combo Delta').locator('select'), 'Starter Beta');
    // ET Zeta au niveau racine, puis Zeta OU Eta.
    await pick(editor.locator(':scope > select').last(), 'Handtrap Zeta');
    await pick(leafOf('Handtrap Zeta').locator('select'), 'Mulcharmy Eta');

    const tree = await editor.evaluate((root) => {
      const read = (el) => {
        const groups = [...el.querySelectorAll(':scope > span')].filter((s) => s.className.includes('border-ink-700'));
        return { groups: groups.length, nested: groups.map((g) => [...g.querySelectorAll('span.border-ink-700')].length) };
      };
      // Structure attendue : racine ET (non encadrée) > 2 groupes OU encadrés, dont un contient un
      // groupe OU encadré (profondeur 3).
      const rootLevel = root.querySelector(':scope > span');
      const orGroups = [...rootLevel.querySelectorAll('span.border-ink-700')];
      const nested = orGroups.filter((g) => g.parentElement.closest('span.border-ink-700') !== null);
      const ops = [...root.querySelectorAll('span.uppercase')].map((s) => s.textContent.trim());
      return { orGroups: orGroups.length, nested: nested.length, ops, leaves: root.querySelectorAll('span.border-dashed').length, read: read(rootLevel) };
    });
    // Attendu : (Xi OU (Delta OU Beta)) ET (Zeta OU Eta) — 3 groupes OU dont 1 imbriqué, 5 feuilles,
    // opérateurs dans l'ordre de lecture : OU, OU, ET, OU.
    expect('arbre profond construit : 3 groupes OU dont 1 imbriqué (ET > OU > OU), 5 feuilles', tree.orGroups === 3 && tree.nested === 1 && tree.leaves === 5, tree);
    expect('opérateurs rendus dans l’ordre : OU, OU, ET, OU', tree.ops.join(',') === 'OU,OU,ET,OU', tree.ops);
    expect('éditeur sans débordement horizontal', await editor.evaluate(fits), await editor.evaluate((el) => [el.scrollWidth, el.clientWidth]));
    expect('section sans débordement', await section.evaluate(fits), await section.evaluate((el) => [el.scrollWidth, el.clientWidth]));
    expect('body sans défilement horizontal', await page.evaluate(noBodyScroll), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    const selects = editor.locator('select');
    const n = await selects.count();
    for (let i = 0; i < n; i++) ge(`sélecteur ${i + 1}/${n} ≥ 24 px`, await box(selects.nth(i)), 24);
    const removes = editor.locator('button[title="Retirer cette condition"]');
    expect('un ✕ par feuille', (await removes.count()) === 5, await removes.count());
    for (let i = 0; i < 5; i++) {
      const b = await box(removes.nth(i));
      expect(`✕ ${i + 1} visible (≥ 12 px)`, !!b && b.w >= 12 && b.h >= 12, b);
    }
    const inputs = editor.locator('input[type="number"]');
    for (let i = 0; i < (await inputs.count()); i++) ge(`« ≥ n » ${i + 1} ≥ 24 px`, await box(inputs.nth(i)), 24);
    const r = await editor.boundingBox();
    expect('éditeur dans le viewport', r && r.x >= -0.5 && r.x + r.width <= W + 0.5, r);
    await item.scrollIntoViewIfNeeded();
    await shot(page, `conditions-${W}-arbre-profond`);
    await item.screenshot({ path: `${process.env.E2E_OUT ?? new URL('../out', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')}/conditions-${W}-item.png` }).catch(() => {});
    log(`${W} px : arbre ${JSON.stringify(tree.ops)} — éditeur ${Math.round(r?.width ?? 0)} px de large`);
    await browser.close();
    failures.push(...local);
  }
  if (failures.length) throw new Error(`gardes en échec :\n  ${failures.join('\n  ')}`);
}
