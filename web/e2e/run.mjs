#!/usr/bin/env node
// Gardes visuelles (étape 7, point 4) : pile JETABLE de bout en bout, puis scénarios
// Playwright sur le Chrome installé. Rien ne touche la base de dev (5433), la suite
// d'intégration (55433), un VPS ou un catalogue distant.
//
//   npm run e2e -w web                      → pile + tous les scénarios + démontage
//   npm run e2e -w web -- --only guards     → scénarios choisis (virgules), la pile est
//                                             montée et démontée quand même
//   npm run e2e -w web -- --keep            → laisse la pile en place (inspection manuelle)
//   npm run e2e -w web -- --attach --only … → réutilise une pile laissée par --keep
//                                             (aucune création de conteneur ni de compte)
//   npm run e2e -w web -- --down            → démonte une pile laissée par --keep
//   npm run e2e -w web -- --db <url> --db-container <nom>
//                                           → base FOURNIE, déjà migrée (répétition 8B) : aucun
//                                             conteneur créé ni démonté, schéma et migrations non
//                                             rejoués, cartes synthétiques insérées par psql dans
//                                             ce conteneur ; serveur, Vite, compte et scénarios
//                                             comme d'habitude. Refusée hors 127.0.0.1 ou sur 5433.
//
// Prérequis : Docker en marche (image postgres:17-alpine), Google Chrome installé (ou
// E2E_BROWSER = chemin d'un Chromium), ports 55434 / 8790 / 5174 libres (E2E_DB_PORT,
// E2E_API_PORT, E2E_WEB_PORT). Captures et journaux dans web/e2e/out/ (ignoré par git).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { E2E } from './lib.mjs';
import { cardsSql } from './fixtures/cards.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 55434);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8790);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const LABEL = 'purpose=testhand-e2e';
const API = `http://localhost:${API_PORT}`;
const ALL_SCENARIOS = ['setup', 'guards', 'compare', 'mobile', 'home', 'conditions', 'nonengine', 'extraside', 'side'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keep = flag('--keep');
const attach = flag('--attach');
const down = flag('--down');
// Base fournie (--db) : jamais la base de dev (5433) ni un hôte distant.
const externalDb = option('--db');
if (externalDb !== undefined) {
  let u;
  try { u = new URL(externalDb); } catch { console.error(`--db : URL invalide (${externalDb})`); process.exit(2); }
  if (u.hostname !== '127.0.0.1' || !u.port || u.port === '5433') { console.error('--db : base jetable sur 127.0.0.1 avec un port explicite différent de 5433 attendue.'); process.exit(2); }
  if (!option('--db-container')) { console.error('--db-container <nom> requis avec --db (cartes synthétiques insérées par psql dans ce conteneur).'); process.exit(2); }
}
const externalUrl = externalDb === undefined ? null : new URL(externalDb);
const CONTAINER = externalUrl ? option('--db-container') : 'testhand-e2e-db';
const DB_USER = externalUrl ? decodeURIComponent(externalUrl.username) : 'e2e';
const DB_PASSWORD = externalUrl ? decodeURIComponent(externalUrl.password) : 'e2e-disposable';
const DB_NAME = externalUrl ? externalUrl.pathname.replace(/^\//, '') : 'e2e';
const DATABASE_URL = externalUrl ? externalUrl.toString() : `postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}`;
const STACK_FILE = path.join(E2E.out, 'stack.json'); // pids laissés par --keep, pour --down
const scenarios = option('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? ALL_SCENARIOS;
for (const s of scenarios) if (!ALL_SCENARIOS.includes(s)) { console.error(`Scénario inconnu : ${s} (${ALL_SCENARIOS.join(', ')})`); process.exit(2); }

if (E2E.base !== `http://localhost:${WEB_PORT}` && !process.env.E2E_BASE) process.env.E2E_BASE = `http://localhost:${WEB_PORT}`;
mkdirSync(E2E.out, { recursive: true });
const log = (msg) => console.log(`[e2e] ${msg}`);
const children = [];

function docker(argv, opts = {}) {
  const r = spawnSync('docker', argv, { encoding: 'utf8', ...opts });
  if (r.error) throw new Error(`docker indisponible : ${r.error.message}`);
  return r;
}

function startDb() {
  const running = docker(['ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.Names}}']).stdout.trim();
  if (running) throw new Error(`Le conteneur ${CONTAINER} existe déjà : docker stop ${CONTAINER} (ou --attach).`);
  const r = docker(['run', '--name', CONTAINER, '--label', LABEL, '--rm', '--tmpfs', '/var/lib/postgresql/data',
    '-e', `POSTGRES_USER=${DB_USER}`, '-e', `POSTGRES_PASSWORD=${DB_PASSWORD}`, '-e', `POSTGRES_DB=${DB_NAME}`,
    '-p', `127.0.0.1:${DB_PORT}:5432`, '-d', 'postgres:17-alpine']);
  if (r.status !== 0) throw new Error(`docker run : ${r.stderr.trim()}`);
  log(`conteneur ${CONTAINER} sur 127.0.0.1:${DB_PORT}`);
}

const psql = (sql) => docker(['exec', '-i', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], { input: sql });

async function waitDb() {
  // pg_isready répond avant la fin de l'initialisation (le serveur redémarre une fois) :
  // on exige deux `select 1` consécutifs espacés d'une seconde.
  let ok = 0;
  for (let i = 0; i < 60 && ok < 2; i++) {
    await sleep(1000);
    ok = psql('select 1;').status === 0 ? ok + 1 : 0;
  }
  if (ok < 2) throw new Error('PostgreSQL jetable injoignable après 60 s.');
}

function applySchema() {
  // Par STDIN, jamais via un fichier monté (inode figé après git pull, cf. AGENTS.md).
  // 003 (étape 8) : base neuve, rien à purger, donc aucune acceptation requise.
  const files = ['db/schema.sql', 'db/migrations/001-deck-configuration.sql', 'db/migrations/002-profiles-and-conditions.sql', 'db/migrations/003-purge-legacy.sql', 'db/migrations/004-side-plans.sql'];
  for (const f of files) {
    const r = psql(readFileSync(path.join(ROOT, f), 'utf8'));
    if (r.status !== 0) throw new Error(`${f} : ${r.stderr.trim()}`);
  }
  applyCards();
  log('schéma, migrations 001 à 004 et cartes synthétiques appliqués');
}

function applyCards() {
  // Idempotent (on conflict do nothing) : sur une base fournie, les passcodes 9000xxxx n'existent
  // pas dans le catalogue réel et ne touchent aucun deck existant.
  const r = psql(cardsSql());
  if (r.status !== 0) throw new Error(`cartes synthétiques : ${r.stderr.trim()}`);
}

function spawnLogged(name, argv, cwd, env) {
  // Journal sur descripteur de fichier et processus détaché : le serveur et Vite
  // survivent à la fin de ce script (--keep) et ne dépendent d'aucun tube (un tube fermé
  // ferait tomber pino sur EPIPE). L'arrêt passe par killPid.
  const fd = openSync(path.join(E2E.out, `${name}.log`), 'w');
  const child = spawn(process.execPath, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], detached: true, windowsHide: true });
  child.on('exit', (code) => { if (!child.expectedExit) log(`${name} terminé prématurément (code ${code}) — voir out/${name}.log`); });
  child.unref();
  children.push({ name, child });
  return child;
}

function startServer() {
  spawnLogged('server', ['--import', 'tsx', 'src/index.ts'], path.join(ROOT, 'server'), {
    DATABASE_URL, PORT: String(API_PORT), APP_ORIGIN: `http://localhost:${WEB_PORT}`,
    INVITE_CODES: E2E.account.invite_code, NODE_ENV: 'development', COOKIE_SECURE: '0', TRUST_PROXY: '0',
  });
}

function startWeb() {
  const vite = ['node_modules/vite/bin/vite.js', 'web/node_modules/vite/bin/vite.js'].map((p) => path.join(ROOT, p)).find(existsSync);
  if (!vite) throw new Error('Vite introuvable : npm install.');
  spawnLogged('web', [vite], path.join(ROOT, 'web'), { WEB_PORT: String(WEB_PORT), API_PROXY: API });
}

async function waitHttp(url, label) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* pas encore prêt */ }
    await sleep(1000);
  }
  throw new Error(`${label} injoignable après 60 s (${url}).`);
}

async function createAccount() {
  const r = await fetch(`${API}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(E2E.account),
  });
  if (r.status === 409) return log('compte de test déjà présent');
  if (!r.ok) throw new Error(`inscription du compte de test → ${r.status} ${await r.text()}`);
  log(`compte ${E2E.account.email} créé`);
}

function killPid(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(pid, 'SIGTERM'); } catch { /* déjà terminé */ } }
}

function stopChildren() {
  for (const { name, child } of children.splice(0)) {
    child.expectedExit = true;
    if (child.exitCode !== null) continue;
    killPid(child.pid);
    log(`${name} arrêté`);
  }
}

function stopDb() {
  const r = docker(['stop', CONTAINER]);
  if (r.status === 0) log(`conteneur ${CONTAINER} arrêté et supprimé (--rm)`);
  const left = docker(['ps', '-a', '--filter', `label=${LABEL}`, '--format', '{{.Names}}']).stdout.trim();
  if (left) log(`ATTENTION : conteneur restant ${left}`);
}

function teardown() {
  if (attach) return;
  if (keep) {
    for (const { child } of children) child.expectedExit = true;
    writeFileSync(STACK_FILE, JSON.stringify({ pids: children.map((c) => ({ name: c.name, pid: c.child.pid })), external: externalUrl !== null }));
    log(`pile conservée (--keep) : ${E2E.base}, API ${API}, base ${DATABASE_URL} — démontage : npm run e2e -w web -- --down`);
    return;
  }
  stopChildren();
  if (!externalUrl) stopDb();
}

if (down) {
  let external = false;
  if (existsSync(STACK_FILE)) {
    const stack = JSON.parse(readFileSync(STACK_FILE, 'utf8'));
    external = stack.external === true;
    for (const { name, pid } of stack.pids) { killPid(pid); log(`${name} (pid ${pid}) arrêté`); }
    rmSync(STACK_FILE);
  }
  if (!external) stopDb();
  process.exit(0);
}

process.on('SIGINT', () => { teardown(); process.exit(130); });

let failed = false;
try {
  if (!attach) {
    if (externalUrl) {
      applyCards();
      log(`base fournie ${DATABASE_URL} (conteneur ${CONTAINER}) : schéma et migrations non rejoués, cartes synthétiques insérées`);
    } else {
      startDb();
      await waitDb();
      applySchema();
    }
    startServer();
    startWeb();
    await waitHttp(`${API}/api/health`, 'API');
    await waitHttp(`${E2E.base}/api/health`, 'Vite (proxy /api)');
    await createAccount();
  } else {
    await waitHttp(`${E2E.base}/api/health`, 'pile existante');
  }
  const ctx = { base: E2E.base, out: E2E.out, api: API, log: (m) => console.log(`  ${m}`) };
  for (const name of scenarios) {
    const t0 = Date.now();
    log(`scénario ${name}`);
    const mod = await import(`./scenarios/${name}.mjs`);
    await mod.default(ctx);
    log(`scénario ${name} : OK (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
} catch (err) {
  failed = true;
  console.error(`[e2e] ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack && !/gardes en échec/.test(err.message)) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
} finally {
  teardown();
}
process.exit(failed ? 1 : 0);
