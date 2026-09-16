// Audit 05 — après une déconnexion explicite, « Précédent » ré-affiche-t-il la page du compte ?
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:8797';
const OUT = process.argv[2];
const stamp = Date.now();
const A = { email: `c${stamp}@audit05.test`, password: 'audit05-compte-C', invite_code: 'audit05-code', display_name: 'Compte C' };
const post = async (url, body, headers = {}) => { const r = await fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0], json: await r.json() }; };
const reg = await post('/api/auth/register', A, { 'x-forwarded-for': '203.0.113.20' });
const cards = Array.from({ length: 20 }, (_, i) => ({ card_id: 10000101 + i, zone: 'main', copies: 2 }));
const deck = await post('/api/decks', { version: 2, name: 'Deck privé de C', cards, starters: [10000101], pairs: [], conditions: [], deadFirst: [], deadSecond: [], matchups: [], params: {}, notes: null }, { cookie: reg.cookie });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
await context.route('https://images.ygoprodeck.com/**', (r) => r.abort());
const page = await context.newPage();
await page.goto('/decks');
await page.fill('#auth-email', A.email);
await page.fill('#auth-password', A.password);
await page.click('button[type="submit"]');
await page.waitForSelector('text=Ouvrir');
await page.goto(`/decks/${deck.json.id}`);
await page.waitForSelector('button[title="Ajouter une carte"]');
const values = async () => (await page.locator('input').evaluateAll((els) => els.map((e) => e.value))).join(' | ');
const before = await values();
// Déconnexion par le menu du compte (AccountMenu : « Se déconnecter ») si présent, sinon depuis l'accueil.
await page.goto('/decks');
await page.waitForSelector('text=Ouvrir');
await page.locator(`button[title="${A.email}"]`).click();
await page.getByText('Se déconnecter').click();
await page.waitForSelector('#auth-email', { timeout: 15000 });
const afterLogout = page.url();
await page.goBack();
await page.waitForTimeout(2500);
const backUrl = page.url();
const backValues = await values();
const text = await page.locator('body').innerText();
await page.screenshot({ path: path.join(OUT, 'S4-precedent-apres-deconnexion.png') });
const result = { avant: before, urlApresDeconnexion: afterLogout, urlApresPrecedent: backUrl, champsApresPrecedent: backValues, pageDeConnexionAffichee: text.includes('Se connecter'), nomDuDeckVisible: (backValues + text).includes('Deck privé de C') };
console.log(JSON.stringify(result, null, 2));
writeFileSync(path.join(OUT, 'precedent-apres-deconnexion.json'), JSON.stringify(result, null, 2));
await browser.close();
