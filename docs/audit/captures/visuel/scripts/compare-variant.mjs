// Variante v2 avec un vrai écart (un starter en moins, une handtrap en plus), puis recapture du comparateur.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('C:/dev/Testhand/package.json');
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5174';
const OUT = 'C:/dev/Testhand/docs/audit/captures/visuel';
const ACC = { email: 'e2e@example.test', password: 'e2e-disposable-pass' };
const DECK = 'Snake-Eye Fiendsmith';
const measures = JSON.parse(fs.readFileSync(path.join(OUT, 'mesures.json'), 'utf8'));
const SCAN = eval('`' + fs.readFileSync('C:/Users/ccrepin/AppData/Local/Temp/claude/c--dev-Testhand/bcb8d50a-2cd4-45c2-a407-fa1d38dddc7d/scratchpad/audit-visuel.mjs', 'utf8').match(/const SCAN = `([sS]*?)`;
async function measure/)[1] + '`');
const log = [];
const L = (m, x = {}) => { log.push({ m, ...x }); console.log(m, JSON.stringify(x)); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx0 = await browser.newContext({ baseURL: BASE });
let r = await ctx0.request.post('/api/auth/login', { data: ACC }); if (!r.ok()) throw new Error('login');
const decks = await (await ctx0.request.get('/api/decks')).json();
const id = decks.find((d) => d.name === DECK).id;
const v2 = decks.find((d) => d.name === DECK + ' v2').id;
if (!process.argv.includes('--measure-only')) {
const dd = await (await ctx0.request.get(`/api/decks/${v2}`)).json();
const conf = (d) => ({ version: 2, name: d.name, cards: d.cards, starters: d.starters, pairs: d.pairs, conditions: d.conditions ?? [], deadFirst: d.deadFirst, deadSecond: d.deadSecond, matchups: d.matchups ?? [], params: d.params ?? {}, notes: d.notes ?? null });
const cards = dd.cards.map((c) => c.zone !== 'main' ? c : c.card_id === 9674034 ? { ...c, copies: 2 } : c.card_id === 97268402 ? { ...c, copies: 2 } : c);
r = await ctx0.request.put(`/api/decks/${v2}`, { data: { configuration: { ...conf(dd), cards }, expectedRevision: dd.revision } });
if (!r.ok()) throw new Error('PUT ' + r.status() + ' ' + await r.text());
L('v2 modifiée : Snake-Eye Ash 3→2, Effect Veiler 1→2');
}
await ctx0.close();

for (const cfg of [{ w: 360, h: 780, mobile: true }, { w: 768, h: 1024, mobile: true }, { w: 1440, h: 900, mobile: false }, { w: 320, h: 640, mobile: true }]) {
  const context = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: cfg.mobile ? 2 : 1, isMobile: cfg.mobile, hasTouch: cfg.mobile, baseURL: BASE, locale: 'fr-FR', colorScheme: 'dark' });
  await context.request.post('/api/auth/login', { data: ACC });
  const page = await context.newPage();
  await page.goto(`/compare/${id}/${v2}`);
  await page.waitForSelector('text=Synthèse', { timeout: 120000 });
  await page.waitForTimeout(800);
  const W = String(cfg.w);
  await page.screenshot({ path: path.join(OUT, `compare-${W}.png`) });
  if (cfg.w !== 320) {
    await page.screenshot({ path: path.join(OUT, `compare-full-${W}.png`), fullPage: true });
    measures[`compare-${W}`] = await page.evaluate(SCAN);
    await page.locator('h2:has-text("Synthèse")').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `compare-synthese-${W}.png`) });
    measures[`compare-synthese-${W}`] = await page.evaluate(SCAN);
  }
  L('recapture compare ' + W);
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'mesures.json'), JSON.stringify(measures, null, 1));
const j = JSON.parse(fs.readFileSync(path.join(OUT, 'journal.json'), 'utf8'));
j.push(...log.map((x) => ({ t: new Date().toISOString(), msg: x.m })));
fs.writeFileSync(path.join(OUT, 'journal.json'), JSON.stringify(j, null, 1));
