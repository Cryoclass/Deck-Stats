// Annotations par défaut, partie D (docs/annotations-par-defaut.md §11 « Découpage révisé ») :
//   D1 compte sans aucun clic : HOPT et profil d'une carte à texte détectable effectifs, badges
//      « auto », aucun choix côté API ;
//   D2 bascule HOPT d'une valeur détectée = choix « non » (« vous ») ; « Revenir au défaut » depuis le
//      détail de carte = plus aucun choix, « auto » revient ;
//   D3 mode Non-engine sur le profil détecté identique : « adopter » (même profil, devenu choix), puis
//      « retirer » ; « oublier mon choix » depuis le menu ⋯ ;
//   D4 un compte référent pose une référence (détail de carte → formulaire) : badges « réf. », aperçus
//      invalidés côté serveur pour TOUS les comptes qui ont la carte ; un autre compte la voit à la
//      recharge ; la page /references la liste avec son désaccord et son journal ;
//   D5 chiffres persistés : l'accueil recalcule et réécrit l'aperçu invalidé ;
//   D6 bandeau une fois par compte : dû à un compte antérieur à la migration, fermé, absent à la
//      recharge, `notices` vide côté API ;
//   D7 à 360 px : formulaire de référence et page /references sans débordement horizontal ;
//   puis restauration (référence retirée, rôle et ancienneté du compte rendus, aucun choix sur les deux
//   cartes, decks « Defaults » des deux comptes supprimés), vérifiée par SQL. Le compte bis, son avis
//   fermé et le journal des références (ajout seul) restent dans la base jetable.
// Données : cartes synthétiques 90000030 (texte détectable) et 90000031 (texte neutre), hors Deck A / B.
import { E2E, launch, login, shot, tile, tileOf, checker } from '../lib.mjs';

const SIGMA = 90000030;
const TAU = 90000031;
const DECK = 'Defaults';
const OTHER = { email: 'e2e-other@example.test', password: 'e2e-other-disposable', display_name: 'E2E bis', invite_code: E2E.account.invite_code };
const CARDS = [SIGMA, TAU, 90000011, 90000012, 90000013, 90000015].map((card_id) => ({ card_id, zone: 'main', copies: 3 }));
const emptyConfiguration = (name) => ({ version: 2, name, cards: CARDS, starters: [SIGMA], pairs: [], conditions: [], deadFirst: [], deadSecond: [], matchups: [], params: {}, notes: null });

export default async function defaults(ctx) {
  const { expect, done } = checker('Annotations par défaut');
  if (typeof ctx?.sql !== 'function') throw new Error('scénario defaults : accès SQL de run.mjs requis (ctx.sql)');
  const email = E2E.account.email.replace(/'/g, "''");
  const { browser, context, page } = await launch();
  await login(context);

  const library = async (c = context) => (await c.request.get('/api/library')).json();
  const choiceOf = async (cardId, c = context) => (await library(c)).choices?.find((x) => x.card_id === cardId) ?? null;
  const until = async (fn, tries = 25) => { let last; for (let i = 0; i < tries; i++) { last = await fn(); if (last.ok) return last; await page.waitForTimeout(200); } return last; };
  const originOf = async (name, aspect) => tileOf(page, name).first().getAttribute(`data-origin-${aspect}`);
  const created = await context.request.post('/api/decks', { data: emptyConfiguration(DECK) });
  expect('deck du scénario créé', created.status() === 201, created.status());
  const id = (await created.json()).id;
  const openEditor = async () => {
    await page.goto('/decks/' + id);
    await page.waitForSelector('button[title="Auto Sigma"]');
    await page.waitForTimeout(500);
  };

  try {
    // ─── D1 : aucun clic ───
    await openEditor();
    expect('D1 Auto Sigma : HOPT détecté', (await originOf('Auto Sigma', 'hopt')) === 'detection');
    expect('D1 Auto Sigma : profil détecté', (await originOf('Auto Sigma', 'nonengine')) === 'detection');
    const badges = await tileOf(page, 'Auto Sigma').first().locator('[data-badge]').allInnerTexts();
    expect('D1 badges « H auto » et « Fx auto » sur la tuile', badges.some((t) => /^H\s*auto$/.test(t.trim())) && badges.some((t) => /^Fx\s*auto$/.test(t.trim())), badges);
    expect('D1 Reference Tau : texte neutre, rien de détecté', (await originOf('Reference Tau', 'hopt')) === null && (await originOf('Reference Tau', 'nonengine')) === null);
    expect('D1 aucun choix côté API pour Auto Sigma', (await choiceOf(SIGMA)) === null, await choiceOf(SIGMA));
    await shot(page, 'defaults-1440-auto');

    // ─── D2 : HOPT choisi puis retour au défaut ───
    await page.locator('div.flex.shrink-0 button').filter({ hasText: 'HOPT' }).first().click();
    await tile(page, 'Auto Sigma').click();
    let r = await until(async () => { const c = await choiceOf(SIGMA); return { ok: c?.is_hopt === false, c }; });
    expect('D2 bascule d’un HOPT détecté = choix « non » côté API', r.ok, r.c);
    await page.click('button:has-text("Terminer")');
    expect('D2 tuile : HOPT d’origine « vous », badge H absent', (await originOf('Auto Sigma', 'hopt')) === 'choice' && (await tileOf(page, 'Auto Sigma').first().locator('[data-badge="hopt"]').count()) === 0);
    await tileOf(page, 'Auto Sigma').first().locator('button:has-text("⋯")').click();
    await page.locator('[role="menuitem"]', { hasText: 'Détails de la carte' }).click();
    await page.waitForSelector('[data-annotations]');
    expect('D2 détail : pastille « vous » sur la ligne HOPT', (await page.locator('[data-annotation-row="hopt"] [data-origin="choice"]').count()) === 1);
    await page.click('[data-reset="hopt"]');
    r = await until(async () => { const c = await choiceOf(SIGMA); return { ok: c === null, c }; });
    expect('D2 revenir au défaut : plus aucun choix côté API', r.ok, r.c);
    await page.waitForSelector('[data-annotation-row="hopt"] [data-origin="detection"]', { timeout: 5000 }).catch(() => {});
    expect('D2 détail : « auto » revenu', (await page.locator('[data-annotation-row="hopt"] [data-origin="detection"]').count()) === 1);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(300);
    expect('D2 tuile : HOPT de nouveau détecté', (await originOf('Auto Sigma', 'hopt')) === 'detection');

    // ─── D3 : adopter puis retirer le profil détecté ───
    await page.click('[data-mode-trigger="nonengine"]');
    await page.click('[data-ne-profile="flexible"]');
    await page.click('[data-mode-trigger="nonengine"]');
    await page.click('[data-ne-label="none"]');
    await page.waitForTimeout(200);
    const effect = () => tile(page, 'Auto Sigma').locator('[data-nonengine-effect]').getAttribute('data-nonengine-effect');
    expect('D3 mode Flexible sur un Flexible détecté : « adopter »', (await effect()) === 'adopter', await effect());
    await tile(page, 'Auto Sigma').click();
    r = await until(async () => { const c = await choiceOf(SIGMA); const p = (await library()).profiles.find((x) => x.card_id === SIGMA); return { ok: c?.nonengine_choice === true && p?.availability === 'flexible', c, p }; });
    expect('D3 adopté : profil flexible matérialisé en choix, même valeur', r.ok, r);
    expect('D3 tuile : profil « vous », prochain clic « retirer »', (await originOf('Auto Sigma', 'nonengine')) === 'choice' && (await effect()) === 'retirer');
    await tile(page, 'Auto Sigma').click();
    r = await until(async () => { const p = (await library()).profiles.find((x) => x.card_id === SIGMA); const c = await choiceOf(SIGMA); return { ok: !p && c?.nonengine_choice === true, c, p }; });
    expect('D3 retiré : « pas non-engine » choisi', r.ok, r);
    await page.click('button:has-text("Terminer")');
    await tileOf(page, 'Auto Sigma').first().locator('button:has-text("⋯")').click();
    await page.locator('[role="menuitem"]', { hasText: 'Profil et plafond : oublier mon choix' }).click();
    r = await until(async () => { const c = await choiceOf(SIGMA); return { ok: c === null, c }; });
    expect('D3 oublier mon choix (menu ⋯) : plus aucun choix', r.ok, r.c);
    await page.waitForTimeout(300);
    expect('D3 tuile : profil de nouveau « auto »', (await originOf('Auto Sigma', 'nonengine')) === 'detection');

    // ─── D4 : référence posée par un référent ───
    // Autre compte, deck qui contient la carte et aperçu en cache (doit être invalidé par l'écriture).
    const other = await browser.newContext({ baseURL: E2E.base, locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
    const reg = await other.request.post('/api/auth/register', { data: OTHER });
    if (reg.status() !== 200 && reg.status() !== 201) {
      const li = await other.request.post('/api/auth/login', { data: { email: OTHER.email, password: OTHER.password } });
      expect('D4 second compte disponible', li.ok(), li.status());
    }
    const otherDeck = await other.request.post('/api/decks', { data: emptyConfiguration(DECK) });
    const otherId = (await otherDeck.json()).id;
    ctx.sql(`update decks set summary = '{"cached":true}'::jsonb where id = '${otherId}';`);

    ctx.sql(`update users set role = 'referent' where lower(email) = lower('${email}');`);
    await openEditor();
    await tileOf(page, 'Reference Tau').first().locator('button:has-text("⋯")').click();
    await page.locator('[role="menuitem"]', { hasText: 'Détails de la carte' }).click();
    await page.click('[data-open-reference]');
    await page.waitForSelector('[data-reference-dialog]');
    await page.click('[data-ref-hopt="yes"]');
    await page.selectOption('select[aria-label="Profil de référence"]', 'reactive');
    await page.fill('textarea[aria-label="Note de référence"]', 'e2e : redondante');
    await shot(page, 'defaults-1440-reference');
    await page.click('[data-ref-save]');
    r = await until(async () => { const lib = await library(other); const ref = lib.references?.find((x) => x.card_id === TAU); return { ok: ref?.is_hopt === true && ref?.availability === 'reactive', ref }; });
    expect('D4 référence visible par l’autre compte (API)', r.ok, r.ref);
    const otherList = await (await other.request.get('/api/decks')).json();
    const otherDeckRow = Array.isArray(otherList) ? otherList.find((d) => d.id === otherId) : undefined;
    const otherSummary = otherDeckRow ? otherDeckRow.summary : 'deck absent';
    expect('D4 aperçu de l’autre compte invalidé', otherSummary === null, otherSummary);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(400);
    expect('D4 tuile du référent : HOPT et profil « réf. »', (await originOf('Reference Tau', 'hopt')) === 'reference' && (await originOf('Reference Tau', 'nonengine')) === 'reference');
    const otherPage = await other.newPage();
    await otherPage.goto('/decks/' + otherId);
    await otherPage.waitForSelector('button[title="Reference Tau"]');
    await otherPage.waitForTimeout(500);
    const otherOrigin = await otherPage.locator('div.group', { has: otherPage.locator('button[title="Reference Tau"]') }).first().getAttribute('data-origin-hopt');
    expect('D4 autre compte, à la recharge : HOPT « réf. »', otherOrigin === 'reference', otherOrigin);
    // Le lien vit dans le menu du compte : on l'ouvre (sinon la garde compterait 0 à tort), chez le
    // référent d'abord (lien présent), puis chez l'autre compte (lien absent).
    await page.locator('header button[title="e2e@example.test"]').first().click();
    const referentLink = await page.locator('[data-nav-references]').count();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await otherPage.locator(`header button[title="${OTHER.email}"]`).first().click();
    await otherPage.waitForTimeout(200);
    const otherLink = await otherPage.locator('[data-nav-references]').count();
    const otherMenuOpen = await otherPage.getByText('Se déconnecter').count();
    expect('D4 menu du compte : lien « Références communes » chez le référent, absent chez l’autre compte', referentLink === 1 && otherMenuOpen === 1 && otherLink === 0, { referentLink, otherMenuOpen, otherLink });

    await page.goto('/references');
    await page.waitForSelector('[data-reference-row]');
    const row = page.locator(`[data-reference-row="${TAU}"]`);
    expect('D4 page /references : ligne Reference Tau', (await row.count()) === 1);
    expect('D4 page /references : désaccord avec la détection signalé', (await row.locator('[data-disagreement]').count()) === 1);
    expect('D4 journal : écriture de Reference Tau', /Reference Tau/.test(await page.locator('[data-reference-log]').innerText()));
    await shot(page, 'defaults-1440-references');

    // ─── D5 : l'accueil recalcule et persiste l'aperçu invalidé ───
    await page.goto('/decks');
    r = await until(async () => { const d = (await (await context.request.get('/api/decks')).json()).find((x) => x.id === id); return { ok: !!d?.summary?.engineVersion, summary: d?.summary ?? null }; }, 75);
    expect('D5 aperçu recalculé et persisté après l’invalidation', r.ok, r.summary);

    // ─── D6 : bandeau une fois par compte ───
    ctx.sql(`update users set created_at = '2000-01-01' where lower(email) = lower('${email}'); delete from user_notices where user_id = (select id from users where lower(email) = lower('${email}'));`);
    await page.goto('/decks');
    await page.waitForSelector('[data-notice="annotation-defaults"]', { timeout: 10000 }).catch(() => {});
    expect('D6 bandeau affiché à un compte antérieur à la migration', (await page.locator('[data-notice="annotation-defaults"]').count()) === 1);
    await shot(page, 'defaults-1440-bandeau');
    await page.click('[data-notice-dismiss]');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('text=Mes decks');
    await page.waitForTimeout(500);
    expect('D6 bandeau fermé : absent à la recharge', (await page.locator('[data-notice="annotation-defaults"]').count()) === 0);
    const me = await (await context.request.get('/api/auth/me')).json();
    expect('D6 API : plus aucun bandeau dû', Array.isArray(me.user.notices) && me.user.notices.length === 0, me.user.notices);

    // ─── D7 : 360 px ───
    const small = await browser.newContext({ baseURL: E2E.base, locale: 'fr-FR', viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await login(small);
    const sp = await small.newPage();
    await sp.goto('/references');
    await sp.waitForSelector('[data-reference-row]');
    const overflow = async () => sp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect('D7 /references à 360 px : aucun débordement horizontal', (await overflow()) <= 0, await overflow());
    await sp.click(`[data-reference-row="${TAU}"] button`);
    await sp.waitForSelector('[data-reference-dialog]');
    const dialog = await sp.locator('[data-reference-dialog]').boundingBox();
    expect('D7 formulaire de référence dans l’écran à 360 px', !!dialog && dialog.x >= 0 && dialog.x + dialog.width <= 360, dialog);
    await shot(sp, 'defaults-360-reference');
    await small.close();
    await other.close();
  } finally {
    // ─── Restauration ───
    await context.request.delete(`/api/references/${TAU}`).catch(() => {});
    ctx.sql(`update users set role = 'user', created_at = now() where lower(email) = lower('${email}');`);
    await context.request.delete(`/api/library/flags/${SIGMA}?aspect=hopt`).catch(() => {});
    await context.request.delete(`/api/library/flags/${SIGMA}?aspect=nonengine`).catch(() => {});
    await context.request.delete(`/api/decks/${id}`).catch(() => {});
    ctx.sql(`delete from decks where name = '${DECK}' and owner_id = (select id from users where lower(email) = lower('${OTHER.email}'));`);
    await browser.close();
  }
  const count = (text) => Number(ctx.sql(text).trim());
  expect('restauration : référence retirée', count(`select count(*) from card_references where card_id = ${TAU};`) === 0);
  expect('restauration : aucun choix sur les cartes du scénario', count(`select count(*) from card_flags where card_id in (${SIGMA}, ${TAU});`) === 0);
  expect('restauration : aucun deck « Defaults »', count(`select count(*) from decks where name = '${DECK}';`) === 0);
  expect('restauration : compte de test rendu (user, créé après la migration)', count(`select count(*) from users where lower(email) = lower('${email}') and role = 'user' and created_at > now() - interval '1 hour';`) === 1);
  done();
}
