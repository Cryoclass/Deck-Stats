// Audit 05 — isolation côté client : A édite son deck, sa session disparaît (expiration ou
// révocation), B se connecte dans le même onglet sans rechargement. Pile jetable seulement.
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:8797';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const stamp = Date.now();
const A = { email: `a${stamp}@audit05.test`, password: 'audit05-compte-A', invite_code: 'audit05-code', display_name: 'Compte A' };
const B = { email: `b${stamp}@audit05.test`, password: 'audit05-compte-B', invite_code: 'audit05-code', display_name: 'Compte B' };
const log = [];
const note = (k, v) => { log.push([k, v]); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };

async function api(method, url, { body, cookie, ip } = {}) {
  const res = await fetch(BASE + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0], json: text ? JSON.parse(text) : null };
}

// 1. Comptes et deck de A (X-Forwarded-For distinct : la limite d'inscription par IP n'est pas l'objet du test).
const ra = await api('POST', '/api/auth/register', { body: A, ip: '203.0.113.10' });
const rb = await api('POST', '/api/auth/register', { body: B, ip: '203.0.113.11' });
note('inscriptions', [ra.status, rb.status]);
const cards = Array.from({ length: 20 }, (_, i) => ({ card_id: 10000001 + i, zone: 'main', copies: 2 }));
const deck = await api('POST', '/api/decks', { cookie: ra.cookie, body: { version: 2, name: 'Deck secret de A', cards, starters: [10000001, 10000002, 10000003], pairs: [], conditions: [], deadFirst: [], deadSecond: [], matchups: [], params: { importance: 0.5 }, notes: 'Note privée de A' } });
note('deck de A', deck);
const deckId = deck.json.id;
const cardNames = (await api('GET', `/api/cards?ids=${cards.map((c) => c.card_id).join(',')}`, { cookie: ra.cookie })).json.map((c) => c.name);

// 2. Navigateur : A se connecte et ouvre son deck.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE, locale: 'fr-FR' });
await context.route('https://images.ygoprodeck.com/**', (r) => r.abort()); // aucun appel au CDN tiers
const page = await context.newPage();
const apiCalls = [];
page.on('response', (r) => { if (r.url().includes('/api/')) apiCalls.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`); });
await page.goto('/decks');
await page.fill('#auth-email', A.email);
await page.fill('#auth-password', A.password);
await page.click('button[type="submit"]');
await page.waitForSelector('text=Ouvrir');
await page.goto(`/decks/${deckId}`);
await page.waitForSelector(`button[title="${cardNames[0]}"]`, { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'S1-A-editeur.png') });
note('étape 1 : A voit son deck', await page.locator(`button[title="${cardNames[0]}"]`).count());

// 3. La session de A disparaît côté serveur (équivalent d'une expiration ou d'une révocation).
const del = spawnSync('docker', ['exec', 'testhand-audit05-db', 'psql', '-U', 'ygo', '-d', 'ygo', '-Atc', `delete from sessions where user_id = '${ra.json.user.id}' returning 1`], { encoding: 'utf8' });
note('sessions de A supprimées', del.stdout.trim().split('\n').length);

// 4. A continue d'éditer : une recherche de carte reçoit 401 → page de connexion, même onglet, même URL.
await page.click('button[title="Ajouter une carte"]');
await page.fill('input[placeholder="Nom de carte ou passcode…"]', 'card');
await page.waitForSelector('#auth-email', { timeout: 15000 });
await page.screenshot({ path: path.join(OUT, 'S2-401-page-connexion.png') });
note('étape 2 : URL au moment du 401', page.url());

// 5. B se connecte dans ce même onglet.
await page.fill('#auth-email', B.email);
await page.fill('#auth-password', B.password);
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, 'S3-B-apres-connexion.png'), fullPage: false });
const me = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user.email);
// Le nom du deck est un <input> éditable : sa valeur ne figure pas dans innerText.
const inputValues = await page.locator('input, textarea').evaluateAll((els) => els.map((e) => e.value));
const text = (await page.locator('body').innerText()) + ' ' + inputValues.join(' ');
const visibleTiles = [];
for (const name of cardNames) if (await page.locator(`button[title="${name}"]`).count()) visibleTiles.push(name);
const deckOfB = await page.evaluate(async (id) => (await fetch(`/api/decks/${id}`)).status, deckId);
note('étape 3 : compte connecté selon /api/auth/me', me);
note('étape 3 : URL', page.url());
note('étape 3 : le nom « Deck secret de A » est affiché', text.includes('Deck secret de A'));
note('étape 3 : tuiles des cartes de A visibles', `${visibleTiles.length} / ${cardNames.length}`);
note('étape 3 : GET /api/decks/<deck de A> avec la session de B', deckOfB);
note('étape 3 : message « Deck introuvable » affiché', text.includes('introuvable'));
note('appels API observés', apiCalls);
writeFileSync(path.join(OUT, 'session-switch-resultats.json'), JSON.stringify(Object.fromEntries(log), null, 2));
await browser.close();
