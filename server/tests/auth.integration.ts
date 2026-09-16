import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { emptyConfiguration } from '../src/domain/deckConfiguration.js';

/**
 * Garde d'authentification, inscription, erreurs (lot 1 de l'audit, 04 O1 / O5 / O10, 05 C1).
 * Monte l'APP RÉELLE (`buildApp`) — garde globale, limites de débit, cookies — sur la base
 * jetable, jamais un Fastify nu avec `req.user` injecté. Conventions de persistence.integration.ts :
 * URL imposée, base vide exigée, réinitialisée à la fin (seulement si elle porte ces fixtures).
 * Budgets de débit par IP (l'app réelle les applique) : 5 inscriptions / 10 min, 10 connexions / min.
 */
const url=new URL(process.env.TEST_DATABASE_URL ?? 'http://missing');
if (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/step23') throw new Error('Use the disposable step23 database on 127.0.0.1:55433 via TEST_DATABASE_URL.');
process.env.DATABASE_URL=url.toString();
// Posés AVANT le chargement de env.js (dotenv n'écrase jamais une variable existante).
process.env.INVITE_CODES='audit-invite';
// Front statique factice : ses routes doivent rester publiques (page de connexion), l'API non.
const webDist=await mkdtemp(path.join(tmpdir(),'testhand-auth-web-'));
await writeFile(path.join(webDist,'index.html'),'<!doctype html><title>front audit</title>');
process.env.WEB_DIST=webDist;
process.env.DISCORD_CLIENT_ID='';
process.env.DISCORD_CLIENT_SECRET='';
process.env.TRUST_PROXY='';
const { pool, query }=await import('../src/db.js');
const { buildApp }=await import('../src/app.js');
const app: FastifyInstance=await buildApp({ logger:false });
// Route ajoutée APRÈS la fabrique, sans aucune marque : le défaut de la garde doit la fermer.
// Elle lève aussi une erreur interne sur demande (gestionnaire d'erreurs).
await app.register(async (a) => {
  a.get<{ Querystring: { boom?: string } }>('/api/audit/unmarked', async (req) => {
    if (req.query.boom) throw Object.assign(new Error('détail interne : duplicate key value violates unique constraint "x_pkey"'), { code:'23505' });
    return { ok:true };
  });
});

const EMAIL_A='audit-a@example.invalid',EMAIL_B='audit-b@example.invalid',PASSWORD='motdepasse-audit';
const SESSION='ygo_session';

before(async () => {
  const tables=await query("select tablename from pg_tables where schemaname='public'");
  assert.equal(tables.rows.length,0,'Integration suite requires a fresh disposable database.');
  await query(await readFile(new URL('../../db/schema.sql',import.meta.url),'utf8'));
  for (const m of ['001-deck-configuration','002-profiles-and-conditions','004-side-plans']) await query(await readFile(new URL(`../../db/migrations/${m}.sql`,import.meta.url),'utf8'));
  await app.ready();
});
after(async () => {
  await app.close();
  // Réinitialise UNIQUEMENT une base qui porte les fixtures de cette suite, pour que la suite
  // `persistence` (base vide exigée) puisse s'enchaîner sur le même conteneur.
  const mine=await query('select 1 from users where email=$1',[EMAIL_A]).catch(() => ({ rowCount:0 }));
  if (mine.rowCount) await query('drop schema public cascade; create schema public;');
  await pool.end();
  await rm(webDist,{ recursive:true,force:true });
});

type Method='GET'|'POST'|'PUT'|'PATCH'|'DELETE';
const inject=(method: Method, url: string, opts: { session?: string; payload?: unknown; headers?: Record<string,string> }={}) =>
  app.inject({ method,url,payload: opts.payload as never,headers: { ...(opts.session ? { cookie:`${SESSION}=${opts.session}` } : {}),...(opts.headers ?? {}) } });
async function register(email: string) {
  const r=await inject('POST','/api/auth/register',{ payload:{ email,password:PASSWORD,invite_code:'audit-invite' } });
  assert.equal(r.statusCode,201,r.body);
  const cookie=r.cookies.find((c) => c.name===SESSION);
  assert.ok(cookie,'cookie de session attendu');
  return { session: cookie.value,cookie };
}
let a: { session: string },b: { session: string };

// ─── 1. Garde d'authentification (04 O1) ───

test('/api/health est public',async () => {
  const r=await inject('GET','/api/health');
  assert.equal(r.statusCode,200,r.body);assert.equal(r.json().ok,true);
});

test('le front statique est public sans session (fichier, repli SPA) ; une route API inconnue vaut 404 sans détail',async () => {
  for (const url of ['/','/index.html','/decks/abc/side']) {
    const r=await inject('GET',url);
    assert.equal(r.statusCode,200,`${url} → ${r.statusCode}`);assert.match(r.body,/front audit/);
  }
  const missing=await inject('GET','/api/nothing');
  assert.equal(missing.statusCode,404);assert.deepEqual(missing.json(),{ error:'introuvable' });
});

test('sans session, toute route non marquée publique répond 401 — y compris par un chemin encodé (/%61pi) et pour une route ajoutée sans marque',async () => {
  const closed: Array<[Method,string]>=[
    ['GET','/api/cards/search?q=audit'],['GET','/api/cards?ids=1'],['GET','/api/cards/483/image'],
    ['GET','/api/decks'],['POST','/api/decks'],['GET','/api/library'],['POST','/api/library/categories'],
    ['GET','/api/auth/me'],['DELETE','/api/auth/discord'],['GET','/api/audit/unmarked'],
    ['GET','/%61pi/cards/search?q=audit&limit=100'],['GET','/%61pi/cards?ids=1'],['GET','/%61pi/cards/abc/image'],
    ['GET','/%61pi/decks'],['GET','/%61pi/library'],['GET','/%61pi/audit/unmarked'],['GET','/api/%63ards/search?q=audit'],
  ];
  for (const [method,url] of closed) {
    const r=await inject(method,url,{ payload: method==='POST' ? {} : undefined });
    assert.equal(r.statusCode,401,`${method} ${url} → ${r.statusCode} ${r.body.slice(0,120)}`);
    assert.deepEqual(r.json(),{ error:'non authentifié' },`${method} ${url}`);
  }
});

test('les routes publiques répondent sans session : inscription, connexion, fournisseurs, déconnexion, départ et retour Discord',async () => {
  assert.equal((await inject('POST','/api/auth/register',{ payload:{ email:EMAIL_A,password:PASSWORD } })).statusCode,403);
  assert.equal((await inject('POST','/api/auth/login',{ payload:{} })).statusCode,400);
  const providers=await inject('GET','/api/auth/providers');
  assert.equal(providers.statusCode,200);assert.deepEqual(providers.json(),{ discord:false });
  assert.equal((await inject('POST','/api/auth/logout')).statusCode,200);
  const start=await inject('GET','/api/auth/discord/start');
  assert.equal(start.statusCode,302);assert.match(String(start.headers.location),/discord_error=not_configured/);
  const callback=await inject('GET','/api/auth/discord/callback?code=x&state=y');
  assert.equal(callback.statusCode,302);assert.match(String(callback.headers.location),/discord_error=state_mismatch/);
});

test('avec une session valide, les routes privées répondent ; le cookie est HttpOnly, SameSite=Lax, Path=/',async () => {
  a=await register(EMAIL_A);
  const { cookie }=a as { cookie: { httpOnly?: boolean; sameSite?: string; path?: string } };
  assert.equal(cookie.httpOnly,true);assert.equal(String(cookie.sameSite).toLowerCase(),'lax');assert.equal(cookie.path,'/');
  const lib=await inject('GET','/api/library',{ session:a.session });
  assert.equal(lib.statusCode,200,lib.body);
  assert.deepEqual(lib.json().categories.map((c: { name: string }) => c.name).sort(),['Board breaker','Handtrap']);
  assert.equal((await inject('GET','/api/cards/search?q=audit',{ session:a.session })).statusCode,200);
  assert.equal((await inject('GET','/api/audit/unmarked',{ session:a.session })).statusCode,200);
  const me=await inject('GET','/api/auth/me',{ session:a.session });
  assert.equal(me.statusCode,200,me.body);assert.equal(me.json().user.email,EMAIL_A);
});

test('un cookie inconnu ou une session expirée valent 401 ; la session expirée est purgée et son cookie effacé',async () => {
  assert.equal((await inject('GET','/api/library',{ session:'inconnu' })).statusCode,401);
  const expired=await register(EMAIL_B);
  b=expired;
  await query('update sessions set expires_at=now() - interval \'1 second\' where user_id=(select id from users where email=$1)',[EMAIL_B]);
  const r=await inject('GET','/api/library',{ session:expired.session });
  assert.equal(r.statusCode,401);
  const cleared=r.cookies.find((c) => c.name===SESSION);
  assert.ok(cleared && cleared.value==='' ,'cookie effacé attendu');
  assert.equal((await query('select count(*)::int as n from sessions where user_id=(select id from users where email=$1)',[EMAIL_B])).rows[0].n,0);
  // Reconnexion de B pour la suite (une session valide).
  const login=await inject('POST','/api/auth/login',{ payload:{ email:EMAIL_B,password:PASSWORD } });
  assert.equal(login.statusCode,200,login.body);
  b={ session: login.cookies.find((c) => c.name===SESSION)!.value };
});

// ─── 2. Inscription : un email hostile ne doit pas geler la boucle d'événements (05 C1) ───

test('une inscription avec un email de 64 000 « @ » et un code valide répond 400 en moins de 50 ms',async () => {
  const t0=performance.now();
  const r=await inject('POST','/api/auth/register',{ payload:{ email:'@'.repeat(64_000),password:PASSWORD,invite_code:'audit-invite' } });
  const ms=performance.now()-t0;
  assert.equal(r.statusCode,400,r.body.slice(0,120));assert.deepEqual(r.json(),{ error:'email invalide' });
  assert.ok(ms<50,`inscription hostile traitée en ${ms.toFixed(0)} ms (attendu < 50 ms)`);
});
