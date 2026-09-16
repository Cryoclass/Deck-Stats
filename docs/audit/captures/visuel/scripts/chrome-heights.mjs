// Hauteur du « chrome » (en-tête, onglets, barre de modes) avant le premier contenu, par largeur.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('C:/dev/Testhand/package.json');
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5174';
const ACC = { email: 'e2e@example.test', password: 'e2e-disposable-pass' };
const out = {};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const cfg of [{ w: 360, h: 780, mobile: true }, { w: 390, h: 844, mobile: true }, { w: 768, h: 1024, mobile: true }, { w: 1440, h: 900, mobile: false }]) {
  const context = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: cfg.mobile ? 2 : 1, isMobile: cfg.mobile, hasTouch: cfg.mobile, baseURL: BASE, locale: 'fr-FR' });
  await context.request.post('/api/auth/login', { data: ACC });
  const page = await context.newPage();
  const decks = await (await context.request.get('/api/decks')).json();
  const id = decks.find((d) => d.name === 'Snake-Eye Fiendsmith').id;
  await page.goto('/decks/' + id);
  await page.waitForSelector('button[title="Snake-Eye Ash"]');
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { top: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) } : null; };
    const header = document.querySelector('header');
    const nav = document.querySelector('main nav');
    const modebar = [...document.querySelectorAll('main div.shrink-0')].find((d) => d.innerText.trim().startsWith('Sélection'));
    const firstTile = document.querySelector('button[title="Snake-Eye Ash"]');
    const tile = firstTile?.closest('div.group');
    const img = firstTile?.querySelector('img');
    const navScroll = nav ? nav.scrollWidth - nav.clientWidth : null;
    const tabs = [...document.querySelectorAll('main nav button')].map((b) => ({ t: b.innerText, ...r(b) }));
    const modes = [...(modebar?.querySelectorAll('button') ?? [])].map((b) => ({ t: b.innerText.replace(/\s+/g, ' '), ...r(b) }));
    const hdrBtns = [...header.querySelectorAll('button, input')].map((b) => ({ t: (b.innerText || b.value || '').slice(0, 20), ...r(b) }));
    const stepper = tile?.querySelector('button[title="Moins de copies"], button[title^="Retirer"]');
    const menu = tile?.querySelector('button[title="Plus d\'actions"]');
    const delta = tile?.querySelector('.tnum.min-w-0');
    const cols = getComputedStyle(tile.parentElement).gridTemplateColumns.split(' ').length;
    return { viewport: { w: innerWidth, h: innerHeight }, header: r(header), nav: r(nav), navOverflowPx: navScroll, modebar: r(modebar), firstTile: r(tile), tileImage: r(img), gridColumns: cols, stepper: r(stepper), menu: r(menu), delta: delta ? { ...r(delta), font: getComputedStyle(delta).fontSize, color: getComputedStyle(delta).color } : null, tabs, modes, hdrBtns };
  });
  m.chromeBeforeContent = m.firstTile.top;
  m.chromeShare = +(m.firstTile.top / m.viewport.h).toFixed(3);
  out[cfg.w] = m;
  console.log(cfg.w, JSON.stringify({ header: m.header.h, nav: m.nav.h, navOverflowPx: m.navOverflowPx, modebar: m.modebar.h, firstTileTop: m.firstTile.top, share: m.chromeShare, cols: m.gridColumns, tile: m.firstTile.w, img: m.tileImage.h, stepper: m.stepper, menu: m.menu, delta: m.delta }));
  await context.close();
}
await browser.close();
fs.writeFileSync('C:/dev/Testhand/docs/audit/captures/visuel/chrome-heights.json', JSON.stringify(out, null, 1));
