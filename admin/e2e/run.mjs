#!/usr/bin/env node
// Garde navigateur du back-office (docs/backoffice.md T13, décision 10) :
//   node admin/e2e/run.mjs            Docker en marche, Google Chrome installé (ou E2E_BROWSER),
//                                     ports 55443 (BO_E2E_DB_PORT) et 8795 (BO_E2E_SITE_PORT) libres
// Monte une pile jetable (conteneur PostgreSQL testhand-backoffice-e2e-db, schéma + 001 à 005, rôle
// restreint avec mot de passe, comptes synthétiques), lance le site .NET (Release) branché avec le
// rôle restreint, puis joue au Chrome installé, à 1440 puis 360 px : connexion, enrôlement puis
// vérification TOTP, tableau de bord, comptes (recherche, tri, pagination), fiche, journal, bascule
// de thème retenue au rechargement, déconnexion ; puis le bandeau PRODUCTION sur un second démarrage.
// Captures et verdict dans admin/e2e/out/ (ignoré par git). Démonte tout, y compris en cas d'échec.
// Jamais la base de dev (5433).
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const { chromium } = createRequire(path.join(ROOT, 'web/package.json'))('playwright-core');
const DB_PORT = Number(process.env.BO_E2E_DB_PORT ?? 55443);
const SITE_PORT = Number(process.env.BO_E2E_SITE_PORT ?? 8795);
const CONTAINER = 'testhand-backoffice-e2e-db';
const BASE = `http://localhost:${SITE_PORT}`;
const OUT = path.join(ROOT, 'admin/e2e/out');
const PROJECT = path.join(ROOT, 'admin/src/Testhand.Admin/Testhand.Admin.csproj');
const ADMIN = { email: 'admin@example.test', password: 'password' };
if (DB_PORT === 5433) throw new Error('port 5433 interdit (base de dev)');
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`[bo-e2e] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const verdicts = [];
let fails = 0;
function check(label, ok, detail = '') {
  const line = `${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`;
  verdicts.push(line); if (!ok) fails++; log(line);
}

function docker(args, opts = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', ...opts });
  if (r.error) throw new Error(`docker indisponible : ${r.error.message}`);
  return r;
}
const psql = (sql) => docker(['exec', '-i', CONTAINER, 'psql', '-U', 'ygo', '-d', 'ygo', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], { input: sql });
const query = (sql) => docker(['exec', '-i', CONTAINER, 'psql', '-U', 'ygo', '-d', 'ygo', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql]).stdout.trim();

function startDb() {
  if (docker(['ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.Names}}']).stdout.trim())
    throw new Error(`Le conteneur ${CONTAINER} existe déjà : docker stop ${CONTAINER}.`);
  const r = docker(['run', '--name', CONTAINER, '--label', 'purpose=testhand-backoffice', '--rm', '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'POSTGRES_USER=ygo', '-e', 'POSTGRES_PASSWORD=ygo-disposable', '-e', 'POSTGRES_DB=ygo', '-p', `127.0.0.1:${DB_PORT}:5432`, '-d', 'postgres:17-alpine']);
  if (r.status !== 0) throw new Error(`docker run : ${r.stderr.trim()}`);
  log(`conteneur ${CONTAINER} sur 127.0.0.1:${DB_PORT}`);
}
async function waitDb() {
  // Deux `select 1` consécutifs : l'entrypoint lance un serveur temporaire pendant l'initialisation.
  let ok = 0;
  for (let i = 0; i < 60 && ok < 2; i++) { await sleep(1000); ok = psql('select 1;').status === 0 ? ok + 1 : 0; }
  if (ok < 2) throw new Error('PostgreSQL jetable injoignable après 60 s.');
}
function seed() {
  for (const f of ['db/schema.sql', 'db/migrations/001-deck-configuration.sql', 'db/migrations/002-profiles-and-conditions.sql', 'db/migrations/003-purge-legacy.sql', 'db/migrations/004-side-plans.sql', 'db/migrations/005-backoffice.sql']) {
    const r = psql(readFileSync(path.join(ROOT, f), 'utf8'));
    if (r.status !== 0) throw new Error(`${f} : ${r.stderr.trim()}`);
  }
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'admin/tests/Testhand.Admin.Tests/fixtures/scrypt-node-vectors.json'), 'utf8'));
  const hash = fixture.entries.find((e) => e.password === ADMIN.password && e.matches).hash;
  const users = [`('${ADMIN.email}', 'Admin E2E', '${hash}', 'admin')`];
  for (let i = 1; i <= 60; i++) users.push(`('joueur-${String(i).padStart(2, '0')}@example.test', 'Joueur ${i}', ${i % 3 === 0 ? 'null' : `'${hash}'`}, 'user')`);
  const r = psql(`
    alter role testhand_backoffice with login password 'bo-disposable';
    insert into users (email, display_name, password_hash, role) values ${users.join(',\n')};
    insert into decks (owner_id, name, notes) select id, 'SECRET-DECK-' || email, 'SECRET-NOTES' from users where email like 'joueur-0%';
    insert into decks (owner_id, name) select id, 'SECRET-DECK-ADMIN' from users where email = '${ADMIN.email}';
    insert into user_identities (provider, provider_user_id, user_id) select 'discord', 'SECRET-' || id, id from users where email like 'joueur-1%';
    insert into sessions (token_hash, user_id, expires_at, user_agent) select sha256(id::text::bytea), id, now() + interval '20 days', 'Mozilla/5.0 (E2E) Chrome' from users where email like 'joueur-2%';
    insert into catalog_version (version, copied_cards_count, local_cards_count) values ('e2e-2026-09', 19, 19);`);
  if (r.status !== 0) throw new Error(`fixture : ${r.stderr.trim()}`);
  log(`schéma, migrations 001 à 005, rôle restreint et ${users.length} comptes synthétiques`);
}

let site = null;
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  child.expectedExit = true;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}
async function startSite(envLabel) {
  const fd = openSync(path.join(OUT, `site-${envLabel.toLowerCase()}.log`), 'w');
  const env = {
    ...process.env,
    BACKOFFICE_DATABASE_URL: `postgres://testhand_backoffice:bo-disposable@127.0.0.1:${DB_PORT}/ygo`,
    BACKOFFICE_TOTP_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64'),
    BACKOFFICE_ENV: envLabel,
    BACKOFFICE_HOST: 'e2e.local',
    ASPNETCORE_URLS: `http://127.0.0.1:${SITE_PORT}`,
    DOTNET_CLI_UI_LANGUAGE: 'fr',
  };
  const child = spawn('dotnet', ['run', '--no-build', '-c', 'Release', '--project', PROJECT], { env, stdio: ['ignore', fd, fd], windowsHide: true });
  child.on('exit', (code) => { if (!child.expectedExit) log(`site terminé prématurément (code ${code}) — voir out/site-${envLabel.toLowerCase()}.log`); });
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try { const r = await fetch(`${BASE}/health`); if (r.ok && (await r.text()) === 'ok') { log(`site ${envLabel} sur ${BASE}`); return child; } } catch { /* pas encore */ }
    if (child.exitCode !== null) throw new Error(`site ${envLabel} tombé (code ${child.exitCode})`);
  }
  throw new Error('site injoignable après 90 s');
}

// TOTP RFC 6238 (SHA-1, 30 s, 6 chiffres) — indépendant du code .NET.
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; const out = [];
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(b).digest(); const o = h[19] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
let lastCounter = -1;
async function freshCode(secret) {
  let counter = Math.floor(Date.now() / 30000);
  if (counter <= lastCounter) { const wait = 30000 - (Date.now() % 30000) + 500; log(`même pas de 30 s : attente ${Math.ceil(wait / 1000)} s (un code ne sert qu'une fois)`); await sleep(wait); counter = Math.floor(Date.now() / 30000); }
  lastCounter = counter;
  return totp(secret, counter);
}

let secretB32 = null;
async function flow(browser, width) {
  const tag = `${width}`;
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 780 : 900 }, baseURL: BASE, isMobile: width < 700 });
  const page = await context.newPage();
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`), fullPage: true });
  const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  const login = await page.goto('/login');
  check(`${tag} /login répond 200 avec le bandeau DEV`, login.status() === 200 && (await page.locator('.env').textContent()).includes('DEV'));
  check(`${tag} /login : CSP posée par le site`, (login.headers()['content-security-policy'] ?? '').includes("default-src 'self'"));
  await shot('login');
  await page.fill('#Email', ADMIN.email);
  await page.fill('#Password', ADMIN.password);
  await Promise.all([page.waitForURL('**/totp'), page.click('.form button[type=submit]')]);
  check(`${tag} connexion → /totp`, page.url().endsWith('/totp'));
  if (!secretB32) {
    const svg = await page.locator('.qr svg').count();
    secretB32 = (await page.locator('code.secret').textContent()).replace(/\s+/g, '');
    check(`${tag} enrôlement : QR et secret base32 affichés`, svg === 1 && secretB32.length === 32, `${secretB32.length} caractères`);
    await shot('totp-enrolement');
  } else {
    check(`${tag} second facteur déjà enrôlé : aucun QR`, (await page.locator('.qr svg').count()) === 0);
    await shot('totp');
  }
  const secret = base32Decode(secretB32);
  await page.fill('#Code', '000000');
  await page.click('.form button[type=submit]');
  await page.waitForSelector('.banner.neg');
  check(`${tag} code faux refusé, message dans le flux`, (await page.locator('.banner.neg').textContent()).includes('Code refusé'));
  await page.fill('#Code', await freshCode(secret));
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('.form button[type=submit]')]);
  check(`${tag} code juste → tableau de bord`, (await page.locator('h1.title').textContent()) === 'Tableau de bord');
  check(`${tag} tableau de bord : 6 indicateurs, comptes = 61`, (await page.locator('.kpi').count()) === 6 && (await page.locator('.kpi').first().locator('.kpi-value').textContent()).trim() === '61');
  check(`${tag} tableau de bord : pas de défilement horizontal de la page`, await noHScroll());
  await shot('dashboard');

  await page.goto('/comptes');
  const rows = await page.locator('table.grid tbody tr').count();
  check(`${tag} /comptes : 50 lignes, page 1 / 2`, rows === 50 && (await page.locator('.pager span').nth(1).textContent()).includes('page 1 / 2'));
  check(`${tag} /comptes : aucun nom de deck dans la page`, !(await page.content()).includes('SECRET-'));
  check(`${tag} /comptes : pas de défilement horizontal de la page (le tableau défile dans son cadre)`, await noHScroll());
  await shot('comptes');
  await page.click('table.grid thead a:has-text("Decks")');
  await page.waitForURL('**/comptes?*tri=decks*');
  check(`${tag} tri par decks (croissant) : en-tête marqué, première ligne à 0 deck`, (await page.locator('th.sorted').count()) === 1 && (await page.locator('table.grid tbody tr').first().locator('td.num').textContent()).trim() === '0');
  await page.click('table.grid thead a:has-text("Decks")');
  await page.waitForURL('**/comptes?*sens=desc*');
  check(`${tag} tri par decks (décroissant) : première ligne à 1 deck`, (await page.locator('table.grid tbody tr').first().locator('td.num').textContent()).trim() === '1');
  await page.goto('/comptes?q=admin');
  check(`${tag} recherche « admin » : une ligne, rôle admin`, (await page.locator('table.grid tbody tr').count()) === 1 && (await page.locator('.tag.ok').textContent()) === 'admin');
  await page.goto('/comptes?p=2');
  check(`${tag} page 2 : 11 lignes`, (await page.locator('table.grid tbody tr').count()) === 11);

  await page.goto('/comptes?q=joueur-21');
  await page.click('table.grid tbody a');
  await page.waitForURL('**/comptes/*');
  const detail = await page.content();
  check(`${tag} fiche : nombre de decks, session active listée, aucun nom de deck`, (await page.locator('h2.head').textContent()).includes('(1)') && (await page.locator('table.grid tbody tr').count()) === 1 && !detail.includes('SECRET-') && (await page.locator('.kpi').count()) === 7);
  check(`${tag} fiche : pas de défilement horizontal de la page`, await noHScroll());
  await shot('compte');

  await page.goto('/journal');
  check(`${tag} /journal : lignes présentes, la consultation elle-même en tête`, (await page.locator('table.grid tbody tr').count()) > 5 && (await page.locator('table.grid tbody tr').first().textContent()).includes('view.audit'));
  await page.selectOption('#action', 'view.account');
  await page.click('.toolbar button[type=submit]');
  await page.waitForURL('**/journal?*action=view.account*');
  const actions = await page.locator('table.grid tbody tr td:nth-child(4)').allTextContents();
  check(`${tag} journal filtré : seulement view.account`, actions.length > 0 && actions.every((a) => a.trim() === 'view.account'));
  await shot('journal');

  const bg = async () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const before = await bg();
  await page.click('#theme-toggle');
  const light = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#theme-toggle');
  const dark = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const darkBg = await bg();
  check(`${tag} thème : système → clair → sombre, fond de page changé`, light === 'light' && dark === 'dark' && darkBg !== before, `${before} → ${darkBg}`);
  await page.reload();
  check(`${tag} thème sombre retenu au rechargement`, (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark' && (await page.locator('#theme-toggle').textContent()).includes('sombre'));
  await shot('journal-sombre');
  await page.goto('/');
  await shot('dashboard-sombre');
  await page.click('#theme-toggle');  // retour au système pour la passe suivante
  check(`${tag} thème : retour au système`, (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === null);

  await Promise.all([page.waitForURL('**/login'), page.click('.topbar form button[type=submit]')]);
  const after = await page.goto('/comptes');
  check(`${tag} déconnexion : /comptes redirige vers /login`, after.url().endsWith('/login'));
  await context.close();
}

const t0 = Date.now();
let browser = null;
try {
  startDb();
  await waitDb();
  seed();
  log('build du site (Release)');
  const build = spawnSync('dotnet', ['build', PROJECT, '-c', 'Release', '--nologo', '-v', 'q'], { encoding: 'utf8', cwd: ROOT });
  if (build.status !== 0) throw new Error(`dotnet build : ${build.stdout}\n${build.stderr}`);
  site = await startSite('DEV');
  browser = await chromium.launch(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER, headless: true } : { channel: 'chrome', headless: true });
  for (const width of [1440, 360]) await flow(browser, width);
  const audit = query("select string_agg(action || ':' || n, ' ' order by action) from (select action, count(*) n from backoffice_audit group by action) t");
  check('journal : chaque étape journalisée (connexion, TOTP, consultations, déconnexion)', ['login.success:2', 'totp.enrol:1', 'totp.failure:2', 'totp.success:2', 'logout:2', 'view.dashboard:', 'view.accounts:', 'view.account:2', 'view.audit:'].every((k) => audit.includes(k)), audit);
  check('journal : aucune ligne modifiable ou effaçable (déclencheur)', docker(['exec', '-i', CONTAINER, 'psql', '-U', 'ygo', '-d', 'ygo', '-qAt', '-c', 'delete from backoffice_audit']).status !== 0);
  killTree(site); site = null;
  await sleep(1500);
  site = await startSite('PRODUCTION');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
  const page = await context.newPage();
  const r = await page.goto('/login');
  check('bandeau PRODUCTION sur le second démarrage', r.status() === 200 && (await page.locator('.env.env-prod').textContent()).includes('PRODUCTION'));
  await page.screenshot({ path: path.join(OUT, 'login-production-1440.png'), fullPage: true });
  await context.close();
} catch (e) {
  check('exécution sans erreur', false, String(e?.stack ?? e));
} finally {
  if (browser) await browser.close().catch(() => {});
  killTree(site);
  docker(['stop', CONTAINER]);
  writeFileSync(path.join(OUT, 'verdict.txt'), verdicts.join('\n') + '\n');
  log(`${verdicts.length - fails} / ${verdicts.length} vérification(s) — ${((Date.now() - t0) / 1000).toFixed(1)} s — captures dans ${OUT}`);
  process.exit(fails ? 1 : 0);
}
