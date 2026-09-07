// Aides communes aux scénarios (portées des scripts 6B du scratchpad, étape 7).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

/** Paramètres de la pile jetable, lus par run.mjs et les scénarios. */
export const E2E = {
  base: process.env.E2E_BASE ?? 'http://localhost:5174',
  out: process.env.E2E_OUT ?? path.resolve(import.meta.dirname, 'out'),
  account: {
    email: 'e2e@example.test',
    password: 'e2e-disposable-pass',
    display_name: 'E2E',
    invite_code: 'e2e-invite',
  },
};

/** Navigateur : Chrome installé (`channel: 'chrome'`) ou exécutable désigné par
 *  E2E_BROWSER (ex. le Chromium du cache Playwright). `playwright-core` ne télécharge rien. */
export async function launch({ width = 1440, height = 900, mobile = false } = {}) {
  const browser = await chromium.launch(
    process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER, headless: true } : { channel: 'chrome', headless: true },
  );
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    baseURL: E2E.base,
    locale: 'fr-FR',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  CONSOLE', m.text()); });
  return { browser, context, page };
}

export async function login(context) {
  const r = await context.request.post('/api/auth/login', {
    data: { email: E2E.account.email, password: E2E.account.password },
  });
  if (!r.ok()) throw new Error(`login → ${r.status()}`);
}

export async function shot(page, name, opts = {}) {
  mkdirSync(E2E.out, { recursive: true });
  const file = path.join(E2E.out, name + '.png');
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  console.log('  capture', name);
  return file;
}

/** Id d'un deck du compte de test, par nom (le premier sans nom). */
export async function deckId(context, name) {
  const r = await context.request.get('/api/decks');
  const decks = await r.json();
  const d = name ? decks.find((x) => x.name === name) : decks[0];
  if (!d) throw new Error(`deck introuvable : ${name}`);
  return d.id;
}

export const tile = (page, name) => page.locator(`button[title="${name}"]`).first();
export const tileOf = (page, name) => page.locator('div.group', { has: page.locator(`button[title="${name}"]`) });

/** Boîte d'un élément, arrondie (cible tactile). */
export async function box(locator) {
  const b = await locator.boundingBox();
  return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null;
}

/** Collecteur d'assertions : toutes les gardes sont évaluées, l'échec est global. */
export function checker(scope) {
  const failures = [];
  const expect = (label, ok, detail) => {
    if (!ok) failures.push(`${scope} · ${label}: ${JSON.stringify(detail ?? null)}`);
  };
  const ge = (label, b, min) => expect(label, !!b && b.w >= min && b.h >= min, b);
  const done = () => {
    if (failures.length) throw new Error(`gardes en échec :\n  ${failures.join('\n  ')}`);
  };
  return { expect, ge, done, failures };
}
