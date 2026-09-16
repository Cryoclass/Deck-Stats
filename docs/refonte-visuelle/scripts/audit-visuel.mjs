// Audit visuel Testhand — captures 360 / 768 / 1440 + mesures (contraste, cibles, tailles de police).
// Lecture seule sur le dépôt : n'écrit que dans docs/audit/captures/visuel/ et le scratchpad.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire('C:/dev/Testhand/package.json');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:5178';
const OUT = 'C:/Users/ccrepin/AppData/Local/Temp/claude/c--dev-Testhand/87a7b984-2e6e-486e-84fb-f9ecbb380ec9/scratchpad/audit/apres';
const SCRATCH = 'C:/Users/ccrepin/AppData/Local/Temp/claude/c--dev-Testhand/87a7b984-2e6e-486e-84fb-f9ecbb380ec9/scratchpad/audit';
const ACC = { email: 'e2e@example.test', password: 'e2e-disposable-pass' };
const ACC2 = { email: 'audit.vide@example.test', password: 'audit-vide-pass-2026', display_name: 'Vide', invite_code: 'e2e-invite' };
const DECK = 'Snake-Eye Fiendsmith';
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });
const journal = [];
const L = (msg, extra = {}) => { journal.push({ t: new Date().toISOString(), msg, ...extra }); console.log(msg, Object.keys(extra).length ? JSON.stringify(extra) : ''); };
const measures = fs.existsSync(path.join(OUT, 'mesures.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'mesures.json'), 'utf8')) : {};

async function launch({ width, height, mobile, colorScheme }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, baseURL: BASE, locale: 'fr-FR', colorScheme: colorScheme ?? 'dark' });
  const page = await context.newPage();
  page.on('pageerror', (e) => L('PAGEERROR ' + e.message));
  return { browser, context, page };
}
async function login(context, acc = ACC) {
  const r = await context.request.post('/api/auth/login', { data: { email: acc.email, password: acc.password } });
  if (!r.ok()) throw new Error(`login → ${r.status()}`);
}
async function shot(page, name, opts = {}) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  L('capture ' + name);
  return file;
}
const modeBtn = (page, label) => page.locator('div.flex.shrink-0 button').filter({ hasText: label }).first();
const tile = (page, name) => page.getByTitle(name, { exact: true }).first();
const menuItem = (page, text) => page.locator('[role="menuitem"], [role="menuitemradio"]', { hasText: text }).first();
const done = (page) => page.click('button:has-text("Terminer")');

// ─── Mesures dans la page ───
const SCAN = `(() => {
  const toSrgb = (s) => {
    let m;
    if ((m = s.match(/^rgba?\\(([^)]+)\\)$/))) { const p = m[1].split(/[ ,\\/]+/).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: isNaN(p[3]) ? 1 : p[3] }; }
    if ((m = s.match(/^color\\(srgb ([^)]+)\\)$/))) { const p = m[1].split(/[ \\/]+/).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: isNaN(p[3]) ? 1 : p[3] }; }
    if ((m = s.match(/^oklch\\(([^)]+)\\)$/))) {
      const p = m[1].split(/[ \\/]+/).map(parseFloat); const Lc = p[0], C = p[1], H = p[2]; const a = isNaN(p[3]) ? 1 : p[3];
      const hr = (H * Math.PI) / 180; const A = C * Math.cos(hr), B = C * Math.sin(hr);
      const l_ = Lc + 0.3963377774 * A + 0.2158037573 * B, m_ = Lc - 0.1055613458 * A - 0.0638541728 * B, s_ = Lc - 0.0894841775 * A - 1.2914855480 * B;
      const l = l_ ** 3, mm = m_ ** 3, ss = s_ ** 3;
      const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss, -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss];
      const g = (v) => { v = Math.max(0, Math.min(1, v)); return (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255; };
      return { r: g(lin[0]), g: g(lin[1]), b: g(lin[2]), a };
    }
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    return null;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const imgs = [...document.querySelectorAll('img')].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 0);
  const intersects = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; let e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; e = e.parentElement; } return true; };
  const inViewport = (r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const contrast = new Map(); const fonts = {}; const targets = [];
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'OPTION', 'NOSCRIPT'].includes(el.tagName)) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (!inViewport(rect)) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize); const weight = parseInt(cs.fontWeight, 10) || 400;
    fonts[size] = (fonts[size] || 0) + 1;
    let fg = toSrgb(cs.color); if (!fg) continue;
    let op = 1; let e = el; while (e && e !== document.documentElement) { op *= parseFloat(getComputedStyle(e).opacity); e = e.parentElement; }
    fg = { r: fg.r, g: fg.g, b: fg.b, a: fg.a * op };
    const layers = []; e = el;
    while (e && e !== document.documentElement) { const s = getComputedStyle(e); const c = toSrgb(s.backgroundColor); if (c && c.a > 0) layers.push(c); if (c && c.a >= 1) break; e = e.parentElement; }
    const overImg = imgs.some((r) => intersects(r, rect));
    const composite = (base) => { let bg = base; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg); return bg; };
    const bgBlack = composite({ r: 0, g: 0, b: 0, a: 1 }); const bgWhite = composite({ r: 255, g: 255, b: 255, a: 1 });
    const opaque = layers.length && layers[layers.length - 1].a >= 1;
    const rBlack = ratio(over(fg, bgBlack), bgBlack); const rWhite = ratio(over(fg, bgWhite), bgWhite);
    const r = (overImg || !opaque) ? Math.min(rBlack, rWhite) : rBlack;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 90);
    const key = [hex(over(fg, bgBlack)), hex(bgBlack), size, weight, overImg ? 'img' : '', cls.slice(0, 70)].join('|');
    const cur = contrast.get(key) || { fg: hex(over(fg, bgBlack)), bg: (overImg || !opaque) ? (hex(bgBlack) + '…' + hex(bgWhite)) : hex(bgBlack), fgRaw: cs.color, size, weight, ratio: +r.toFixed(2), need, pass: r >= need, overImage: overImg, opaque: !!opaque, sample: text.slice(0, 40), cls, tag: el.tagName.toLowerCase(), n: 0 };
    cur.n++; contrast.set(key, cur);
  }
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=menuitem], [role=menuitemradio], [role=checkbox]')) {
    if (!visible(el)) continue; const r = el.getBoundingClientRect(); if (!inViewport(r)) continue;
    const label = (el.innerText || el.value || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.type || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    targets.push({ tag: el.tagName.toLowerCase(), label, w: Math.round(r.width), h: Math.round(r.height), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80) });
  }
  return { contrast: [...contrast.values()].sort((a, b) => a.ratio - b.ratio), fonts, targets, doc: { scrollWidth: document.documentElement.scrollWidth, innerWidth } };
})()`;
async function measure(page, name, w) {
  const m = await page.evaluate(SCAN);
  measures[`${name}-${w}`] = m;
  const fails = m.contrast.filter((c) => !c.pass);
  const small = m.targets.filter((t) => Math.min(t.w, t.h) < 24);
  L(`mesure ${name}-${w}`, { textes: m.contrast.length, echecsAA: fails.length, cibles: m.targets.length, ciblesSous24: small.length, scrollWidth: m.doc.scrollWidth });
}

// ─── Préparation de la fixture réelle (une fois, à 1440) ───
async function prepare() {
  const { browser, context, page } = await launch({ width: 1440, height: 900, mobile: false });
  await login(context);
  const decks = await (await context.request.get('/api/decks')).json();
  if (decks.some((d) => d.name === DECK)) { L('fixture déjà présente'); await browser.close(); return; }
  await page.goto('/decks');
  await page.waitForSelector('text=Mes decks');
  await page.click('button:has-text("+ Nouveau deck")');
  await page.fill('input[placeholder="ex. Ryzeal going second"]', DECK);
  await page.locator('input[type="file"]').first().setInputFiles(path.join(SCRATCH, 'snake-eye-fiendsmith.ydk'));
  await page.waitForURL(/\/decks\/[0-9a-f-]+$/, { timeout: 20000 });
  await page.waitForSelector('button[title="Snake-Eye Ash"]');
  await page.waitForTimeout(800);
  L('deck réel importé (YDK, 40 main / 13 extra / 15 side)');
  const starters = ['Snake-Eye Ash', 'Snake-Eyes Poplar', 'Diabellstar the Black Witch', 'WANTED: Seeker of Sinful Spoils', 'Bonfire', 'Fiendsmith Engraver', 'Original Sinful Spoils - Snake-Eye'];
  await modeBtn(page, 'Starter').click();
  for (const n of starters) await tile(page, n).click();
  await done(page);
  await modeBtn(page, 'Lier combo').click();
  await tile(page, "Fiendsmith's Tract").click();
  await tile(page, 'Fabled Lurrie').click();
  await page.click('button:has-text("Nouveau pivot")');
  await tile(page, 'Snake-Eye Oak').click();
  await tile(page, 'Snake-Eyes Poplar').click();
  await tile(page, 'Called by the Grave').click();
  await done(page);
  await modeBtn(page, 'HOPT').click();
  for (const n of ['Ash Blossom & Joyous Spring', 'Maxx "C"', 'Mulcharmy Fuwalos', 'Mulcharmy Purulia', 'Nibiru, the Primal Being', 'Called by the Grave', 'Infinite Impermanence', 'Pot of Prosperity', 'Triple Tactics Talent']) await tile(page, n).click();
  await page.waitForTimeout(300);
  await done(page);
  await modeBtn(page, 'Non-engine').click();
  await menuItem(page, 'Handtrap').click();
  for (const n of ['Ash Blossom & Joyous Spring', 'Maxx "C"', 'Mulcharmy Fuwalos', 'Mulcharmy Purulia', 'Nibiru, the Primal Being', 'Effect Veiler', 'Infinite Impermanence']) { await tile(page, n).click(); await page.waitForTimeout(150); }
  await modeBtn(page, 'Non-engine').click();
  await menuItem(page, 'Board breaker').click();
  await tile(page, 'Triple Tactics Talent').click();
  await page.waitForTimeout(300);
  await done(page);
  await modeBtn(page, 'Profil').click();
  await menuItem(page, 'Flexible').click();
  for (const n of ['Ash Blossom & Joyous Spring', 'Effect Veiler', 'Infinite Impermanence', 'Nibiru, the Primal Being']) await tile(page, n).click();
  await modeBtn(page, 'Profil').click();
  await menuItem(page, 'Précoce').click();
  for (const n of ['Maxx "C"', 'Mulcharmy Fuwalos', 'Mulcharmy Purulia']) await tile(page, n).click();
  await page.waitForTimeout(400);
  await done(page);
  // Triple Tactics Talent reste étiquetée SANS profil (état d'avertissement réel).
  await modeBtn(page, 'Condition').click();
  await tile(page, 'Diabellstar the Black Witch').click();
  await tile(page, 'WANTED: Seeker of Sinful Spoils').click();
  await page.waitForTimeout(300);
  await done(page);
  await page.waitForTimeout(800);
  await page.click('button[data-save]');
  await page.waitForSelector('text=/enregistré/');
  await page.waitForTimeout(500);
  L('annotations posées et enregistrées');

  // Plans de side par l'API (même mécanique que web/e2e/scenarios/sidesheet.mjs).
  const id = (await (await context.request.get('/api/decks')).json()).find((d) => d.name === DECK).id;
  const detail = async () => (await context.request.get(`/api/decks/${id}`)).json();
  const conf = (d) => ({ version: 2, name: d.name, cards: d.cards, starters: d.starters, pairs: d.pairs, conditions: d.conditions ?? [], deadFirst: d.deadFirst, deadSecond: d.deadSecond, matchups: d.matchups ?? [], params: d.params ?? {}, notes: d.notes ?? null });
  const MAXX = 23434538, FUWA = 42141493, PURU = 84192580, POT = 84211599, NIB = 27204311, BYS = 32731036;
  const SHIFT = 91800273, DROLL = 94145021, EVEN = 15693423, DUST = 18144506, STORM = 14532163, COSMIC = 8267140, OGRE = 59438930;
  const plan = (position, note, outgoing, incoming) => ({ position, note, outgoing, incoming });
  const matchups = [
    { id: randomUUID(), name: 'Yubel', sort_index: 0, plans: [
      plan('first', 'Garder Impermanence pour Phantom of Yubel.', [{ card_id: MAXX, copies: 3 }], [{ card_id: DROLL, copies: 3 }]),
      plan('second', 'Evenly avant tout ; Storm si board fermé.', [{ card_id: FUWA, copies: 2 }, { card_id: PURU, copies: 2 }], [{ card_id: EVEN, copies: 3 }, { card_id: STORM, copies: 1 }]) ] },
    { id: randomUUID(), name: 'Ryzeal', sort_index: 1, plans: [
      plan('first', 'Shifter les coupe du cimetière.', [{ card_id: PURU, copies: 2 }, { card_id: POT, copies: 1 }], [{ card_id: SHIFT, copies: 3 }]),
      plan('second', null, [{ card_id: NIB, copies: 1 }, { card_id: BYS, copies: 1 }], [{ card_id: OGRE, copies: 1 }, { card_id: COSMIC, copies: 1 }]) ] },
    { id: randomUUID(), name: 'Maliss', sort_index: 2, plans: [
      plan('first', null, [{ card_id: FUWA, copies: 2 }], [{ card_id: DROLL, copies: 2 }]),
      plan('second', 'Plan à finir : il manque une entrée.', [{ card_id: MAXX, copies: 3 }], [{ card_id: EVEN, copies: 2 }]) ] },
    { id: randomUUID(), name: 'Tenpai', sort_index: 3, plans: [
      plan('first', 'Duster + Shifter.', [{ card_id: PURU, copies: 2 }, { card_id: FUWA, copies: 2 }], [{ card_id: SHIFT, copies: 3 }, { card_id: DUST, copies: 1 }]),
      plan('second', null, [], []) ] },
  ];
  const d = await detail();
  const r = await context.request.put(`/api/decks/${id}`, { data: { configuration: { ...conf(d), matchups }, expectedRevision: d.revision } });
  if (!r.ok()) throw new Error(`PUT matchups → ${r.status()} ${await r.text()}`);
  L('4 adversaires et plans de side enregistrés (API)');
  // Variante pour le comparateur : dupliquer puis modifier trois quantités.
  const dup = await context.request.post(`/api/decks/${id}/duplicate`);
  if (!dup.ok()) throw new Error(`duplicate → ${dup.status()}`);
  const list = await (await context.request.get('/api/decks')).json();
  const copy = list.find((x) => x.id !== id && x.name.startsWith(DECK));
  const dd = await (await context.request.get(`/api/decks/${copy.id}`)).json();
  const cards = dd.cards.map((c) => c.zone !== 'main' ? c : c.card_id === MAXX ? { ...c, copies: 2 } : c.card_id === FUWA ? { ...c, copies: 3 } : c).filter((c) => !(c.zone === 'main' && c.card_id === POT));
  cards.push({ card_id: 35269904, zone: 'main', copies: 1 });
  const r2 = await context.request.put(`/api/decks/${copy.id}`, { data: { configuration: { ...conf(dd), name: DECK + ' v2', cards, matchups: [] }, expectedRevision: dd.revision } });
  if (!r2.ok()) throw new Error(`PUT variante → ${r2.status()} ${await r2.text()}`);
  L('variante « v2 » créée pour le comparateur');
  // Compte vide pour les états initiaux.
  const reg = await context.request.post('/api/auth/register', { data: ACC2 });
  L(`compte vide : ${reg.status()}`);
  await browser.close();
}

// ─── Captures par largeur ───
const WIDTHS = [
  { w: 360, h: 780, mobile: true },
  { w: 768, h: 1024, mobile: true },
  { w: 1440, h: 900, mobile: false },
];

async function captureWidth({ w, h, mobile }) {
  const W = String(w);
  // Page de connexion (sans session).
  {
    const { browser, page } = await launch({ width: w, height: h, mobile });
    await page.goto('/decks');
    await page.waitForSelector('text=Connexion');
    await page.waitForTimeout(400);
    await shot(page, `login-${W}`);
    await measure(page, 'login', W);
    await page.click('button:has-text("Inscription")');
    await page.fill('#auth-email', 'nouveau@example.test');
    await page.fill('#auth-password', 'motdepasse-2026');
    await page.waitForTimeout(200);
    await shot(page, `register-${W}`);
    await measure(page, 'register', W);
    await page.click('button:has-text("Connexion")');
    await page.fill('#auth-email', 'inconnu@example.test');
    await page.fill('#auth-password', 'mauvais-mdp');
    await page.click('button:has-text("Se connecter")');
    await page.waitForSelector('p.text-red-400', { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(300);
    await shot(page, `login-erreur-${W}`);
    await browser.close();
  }
  // Compte vide : accueil vide, dialogue d'import, éditeur vide.
  {
    const { browser, context, page } = await launch({ width: w, height: h, mobile });
    await login(context, ACC2);
    await page.goto('/decks');
    await page.waitForSelector('text=Mes decks');
    await page.waitForTimeout(600);
    await shot(page, `home-vide-${W}`);
    await measure(page, 'home-vide', W);
    await page.click('button:has-text("+ Nouveau deck")');
    await page.waitForSelector('text=Nouveau deck');
    await page.waitForTimeout(300);
    await shot(page, `import-dialog-${W}`);
    await measure(page, 'import-dialog', W);
    const existing = await (await context.request.get('/api/decks')).json();
    if (existing.length === 0) {
      await page.fill('input[placeholder="ex. Ryzeal going second"]', 'Deck vide');
      await page.click('button:has-text("Créer un deck vide")');
      await page.waitForURL(/\/decks\/[0-9a-f-]+$/);
    } else { await page.keyboard.press('Escape'); await page.goto('/decks/' + existing[0].id); }
    await page.waitForSelector('text=Importe un deck');
    await page.waitForTimeout(400);
    await shot(page, `editor-vide-${W}`);
    await measure(page, 'editor-vide', W);
    await browser.close();
  }
  // Compte principal.
  const { browser, context, page } = await launch({ width: w, height: h, mobile });
  await login(context);
  const decks = await (await context.request.get('/api/decks')).json();
  const id = decks.find((d) => d.name === DECK).id;
  const v2 = decks.find((d) => d.name === DECK + ' v2').id;
  await page.goto('/decks');
  await page.waitForSelector('text=Mes decks');
  await page.waitForFunction(() => document.querySelectorAll('[data-preview="ready"]').length >= 4, null, { timeout: 60000 }).catch(() => L('aperçus non prêts à temps'));
  await page.waitForTimeout(800);
  await shot(page, `home-${W}`);
  await measure(page, 'home', W);
  await page.locator('button:has-text("⋯")').first().click();
  await page.waitForSelector('[role="menu"]');
  await page.waitForTimeout(200);
  await shot(page, `home-menu-deck-${W}`);
  await page.keyboard.press('Escape');
  await page.click('button:has-text("⇄ Comparer")');
  await page.waitForSelector('text=Comparer deux decks');
  await page.waitForTimeout(200);
  await shot(page, `compare-dialog-${W}`);
  await measure(page, 'compare-dialog', W);
  await page.locator('button[title="Fermer"]').click();
  await page.waitForTimeout(200);
  await page.locator(`button[title="${ACC.email}"]`).click();
  await page.waitForTimeout(200);
  await shot(page, `account-menu-${W}`);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, h - 5);

  // Éditeur — Annoter.
  await page.goto('/decks/' + id);
  await page.waitForSelector('button[title="Snake-Eye Ash"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Recalcul…') && !document.body.innerText.includes('Calcul initial'), null, { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(1200);
  await shot(page, `editor-annoter-${W}`);
  await measure(page, 'editor-annoter', W);
  await page.locator('[data-zone-section]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, `editor-annoter-zones-${W}`);
  await page.locator('main div.min-h-0.flex-1.overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 0));
  await modeBtn(page, 'Starter').click();
  await page.waitForTimeout(300);
  await shot(page, `editor-mode-starter-${W}`);
  await measure(page, 'editor-mode-starter', W);
  await done(page);
  await modeBtn(page, 'Lier combo').click();
  await tile(page, 'Snake-Eye Oak').click();
  await page.waitForTimeout(300);
  await shot(page, `editor-mode-combo-${W}`);
  await done(page);
  await modeBtn(page, 'Non-engine').click();
  await page.waitForSelector('[role="menu"]');
  await page.waitForTimeout(200);
  await shot(page, `editor-menu-nonengine-${W}`);
  await measure(page, 'editor-menu-nonengine', W);
  await page.keyboard.press('Escape');
  const first = page.locator('div.group', { has: page.locator('button[title="Snake-Eye Ash"]') }).first();
  await first.locator('button[title="Plus d\'actions"]').click();
  await page.waitForSelector('[role="menu"]');
  await page.waitForTimeout(200);
  await shot(page, `editor-card-menu-${W}`);
  await measure(page, 'editor-card-menu', W);
  await menuItem(page, 'Détails de la carte').click();
  await page.waitForSelector('text=passcode');
  await page.waitForTimeout(400);
  await shot(page, `editor-card-detail-${W}`);
  await measure(page, 'editor-card-detail', W);
  await page.locator('div.fixed.inset-0').last().click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  await page.locator('button[title="Ajouter une carte"]').first().scrollIntoViewIfNeeded();
  await page.locator('button[title="Ajouter une carte"]').first().click();
  await page.waitForSelector('input[placeholder="Nom de carte ou passcode…"]');
  await page.fill('input[placeholder="Nom de carte ou passcode…"]', 'sn');
  await page.waitForTimeout(800);
  await shot(page, `editor-add-card-${W}`);
  await measure(page, 'editor-add-card', W);
  await page.locator('div.fixed.inset-0').last().click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  await page.locator('main div.min-h-0.flex-1.overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 0));
  const nib = page.locator('div.group', { has: page.locator('button[title="Nibiru, the Primal Being"]') }).first();
  await nib.scrollIntoViewIfNeeded();
  await nib.locator('button[title="Retirer du deck (0 copie)"]').click();
  await page.waitForSelector('button:has-text("Annuler")');
  await page.waitForTimeout(300);
  await shot(page, `editor-toast-${W}`);
  await measure(page, 'editor-toast', W);
  await page.click('button:has-text("Annuler")');
  await page.waitForTimeout(300);
  // Refonte : le réglage de contexte est dans le panneau « Probabilités » (onglet Stats sous 1024 px).
  if (mobile) await page.click('nav button[title="Stats"]');
  await page.locator('button[title="Second · 5 cartes + pioche"]:visible').first().click();
  if (mobile) await page.click('nav button[title="Annoter"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Recalcul…'), null, { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(600);
  if (!mobile) { await shot(page, `editor-second-${W}`); }
  const tabs = [['Combos & catégories', 'combos'], ['Mur de mains', 'mains'], ['Inventaire', 'inventaire'], ['Plans de side', 'side']];
  if (mobile) tabs.unshift(['Stats', 'stats']);
  for (const [label, key] of tabs) {
    await page.click(`nav button[title="${label}"]`);
    await page.waitForTimeout(700);
    if (key === 'inventaire') { await page.locator('button:has-text("Starters")').first().click().catch(() => null); await page.waitForTimeout(300); }
    if (key === 'side') { await page.waitForSelector('[data-side-planner]'); await page.waitForFunction(() => document.querySelector('[data-plan-figures="ready"]') !== null, null, { timeout: 60000 }).catch(() => null); await page.waitForTimeout(400); }
    await shot(page, `editor-${key}-${W}`);
    await measure(page, `editor-${key}`, W);
    if (key === 'stats') { await page.locator('main .overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 9999)).catch(() => null); await page.waitForTimeout(300); await shot(page, `editor-stats-bas-${W}`); await measure(page, 'editor-stats-bas', W); }
    if (key === 'mains') { await page.locator('button:has-text("Nouvelles mains")').click(); await page.waitForTimeout(400); }
    if (key === 'side') {
      await page.locator('[data-copy="main"][data-state="free"]').first().click();
      await page.locator('[data-copy="side"][data-state="free"]').first().click();
      await page.waitForTimeout(300);
      await shot(page, `editor-side-selection-${W}`);
      await page.locator('button:has-text("Vider la sélection")').click();
    }
  }
  if (!mobile) {
    await page.click('nav button[title="Annoter"]');
    await page.locator('aside .overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 9999));
    await page.waitForTimeout(300);
    await shot(page, `editor-panneau-bas-${W}`);
    await measure(page, 'editor-panneau-bas', W);
    await page.locator('aside .overflow-y-auto').first().evaluate((el) => el.scrollTo(0, 0));
  }
  await page.click('nav button[title="Annoter"]');
  await page.waitForSelector('button[title="Snake-Eye Ash"]');
  const oak = page.locator('div.group', { has: page.locator('button[title="Snake-Eye Oak"]') }).first();
  await oak.scrollIntoViewIfNeeded();
  await oak.locator('button[title="Plus de copies"]').click();
  await page.waitForTimeout(1200);
  await shot(page, `editor-dirty-${W}`);
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.waitForSelector('text=Modifications non enregistrées retrouvées', { timeout: 10000 }).catch(() => L('bandeau de brouillon absent'));
  await page.waitForTimeout(600);
  await shot(page, `editor-brouillon-${W}`);
  await measure(page, 'editor-brouillon', W);
  await page.click('button:has-text("Ignorer")').catch(() => null);
  await page.waitForTimeout(400);

  // Comparateur.
  await page.goto(`/compare/${id}/${v2}`);
  await page.waitForSelector('text=Synthèse', { timeout: 90000 });
  await page.waitForTimeout(600);
  await shot(page, `compare-${W}`);
  await shot(page, `compare-full-${W}`, { fullPage: true });
  await measure(page, 'compare', W);
  await page.locator('h2:has-text("Synthèse")').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, `compare-synthese-${W}`);
  await measure(page, 'compare-synthese', W);

  // Fiche imprimable.
  await page.goto(`/decks/${id}/side/fiche`);
  await page.waitForSelector('[data-sheet-matchup]');
  const btn = page.locator('[data-compute-all]');
  if (await btn.isEnabled()) { await btn.click(); await page.waitForSelector('[data-compute-all]:has-text("Chiffres à jour")', { timeout: 120000 }).catch(() => null); }
  await page.waitForTimeout(800);
  await shot(page, `fiche-${W}`);
  await shot(page, `fiche-full-${W}`, { fullPage: true });
  await measure(page, 'fiche', W);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  await shot(page, `fiche-print-full-${W}`, { fullPage: true });
  await measure(page, 'fiche-print', W);
  await page.emulateMedia({ media: 'screen' });

  if (!mobile) {
    await page.goto('/decks/00000000-0000-0000-0000-000000000000');
    await page.waitForSelector('text=Retour aux decks');
    await page.waitForTimeout(300);
    await shot(page, `editor-introuvable-${W}`);
  }
  await browser.close();
}

async function themeCheck() {
  const a = await launch({ width: 1440, height: 900, mobile: false, colorScheme: 'light' });
  await a.page.goto('/decks'); await a.page.waitForSelector('text=Connexion'); await a.page.waitForTimeout(400);
  await shot(a.page, 'login-1440-prefers-light');
  const bg = await a.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  L('prefers-color-scheme: light → fond du body', { bg });
  await a.browser.close();
  const b = await launch({ width: 320, height: 640, mobile: true });
  await login(b.context);
  const decks = await (await b.context.request.get('/api/decks')).json();
  const id = decks.find((d) => d.name === DECK).id;
  const v2 = decks.find((d) => d.name === DECK + ' v2').id;
  for (const [name, url] of [['home', '/decks'], ['editor-annoter', '/decks/' + id], ['compare', `/compare/${id}/${v2}`]]) {
    await b.page.goto(url);
    await b.page.waitForTimeout(name === 'compare' ? 10000 : 3000);
    const sw = await b.page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: innerWidth, overflow: [...document.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.getBoundingClientRect().width > 0).slice(0, 8).map((e) => e.tagName + '.' + String(e.className).slice(0, 50)) }));
    L(`reflow 320 ${name}`, sw);
    await shot(b.page, `${name}-320`);
  }
  await b.browser.close();
}

try {
  if (!ONLY || ONLY.includes('prepare')) await prepare();
  for (const cfg of WIDTHS) if (!ONLY || ONLY.includes(String(cfg.w))) await captureWidth(cfg);
  if (!ONLY || ONLY.includes('theme')) await themeCheck();
} catch (e) {
  L('ÉCHEC ' + (e.stack || e.message));
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'mesures.json'), JSON.stringify(measures, null, 1));
  fs.writeFileSync(path.join(OUT, 'journal.json'), JSON.stringify(journal, null, 1));
}
