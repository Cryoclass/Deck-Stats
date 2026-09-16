// Seconde série de sondes de l'audit 04 : pile JETABLE seulement (API 8796, PostgreSQL 55460).
// Requêtes lourdes par node:http, sans délai côté client (undici abandonne à 300 s).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BASE = new URL(process.env.BASE ?? 'http://127.0.0.1:8796');
const OUT = process.argv[2];
const ONLY = process.argv[3]?.split(',');
const results = [];
const log = (id, what, data) => { results.push({ id, what, at: new Date().toISOString(), ...data }); console.log(id, what, JSON.stringify(data).slice(0, 600)); if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2)); };
const run = (id) => !ONLY || ONLY.includes(id);

function req(method, path, { body, raw, cookie, headers = {} } = {}) {
  return new Promise((resolve) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    let payload = raw;
    if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    if (payload !== undefined) h['content-length'] = Buffer.byteLength(payload);
    const t0 = performance.now();
    const r = http.request({ host: BASE.hostname, port: BASE.port, path, method, headers: h }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = d.slice(0, 200); } resolve({ status: res.statusCode, body: j, ms: Math.round(performance.now() - t0), setCookie: res.headers['set-cookie']?.[0] }); });
    });
    r.on('error', (e) => resolve({ status: 'ERR', body: String(e), ms: Math.round(performance.now() - t0) }));
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}
const cookieOf = (r) => (r.setCookie ?? '').split(';')[0];
const cfg = (over = {}) => ({ version: 2, name: 'Audit', cards: [], starters: [], pairs: [], conditions: [], deadFirst: [], deadSecond: [], matchups: [], params: {}, notes: null, ...over });
const KiB = (o) => Math.round(Buffer.byteLength(JSON.stringify(o)) / 1024);
const fill = (budget, sizeOf, make) => { const out = []; let bytes = 2; for (let i = 1; ; i++) { const s = sizeOf(i) + 1; if (bytes + s > budget) break; bytes += s; out.push(make(i)); } return out; };

// Sonde de latence pendant une opération : /api/auth/providers (boucle d'événements seule) et
// /api/health (boucle + une connexion du pool).
async function during(promise) {
  const loop = [], db = []; let done = false;
  const p = promise.then((r) => { done = true; return r; });
  const poll = (async () => { while (!done) { loop.push((await req('GET', '/api/auth/providers')).ms); db.push((await req('GET', '/api/health')).ms); } })();
  const r = await p; await poll;
  return { r, loopMaxMs: Math.max(0, ...loop), dbMaxMs: Math.max(0, ...db), samples: loop.length };
}

const login = async (email) => cookieOf(await req('POST', '/api/auth/login', { body: { email, password: 'motdepasse-audit' } }));
// Base neuve : comptes recréés (4 inscriptions, sous la limite de 5 / 10 min).
const regs = {};
for (const e of ['a', 'b', 'c', 'd']) regs[e] = (await req('POST', '/api/auth/register', { body: { email: `${e}@audit.test`, password: 'motdepasse-audit', invite_code: 'audit04' } })).status;
const A = await login('a@audit.test');
const B = await login('b@audit.test');
log('Q0', 'comptes et sessions', { inscriptions: regs, A: !!A, B: !!B });

if (run('Q1')) {
  // 24 000 lignes environ : une insertion par ligne dans la transaction (deckRepository.ts:40).
  const cards = fill(1_000_000, (i) => `{"card_id":${i},"zone":"main","copies":1}`.length, (i) => ({ card_id: i, zone: 'main', copies: 1 }));
  const c = cfg({ name: 'cards', cards });
  const m = await during(req('POST', '/api/decks', { cookie: A, body: c }));
  log('Q1', `POST /api/decks : ${cards.length} lignes, ${KiB(c)} Kio`, { status: m.r.status, ms: m.r.ms, loopMaxMs: m.loopMaxMs, dbMaxMs: m.dbMaxMs, samples: m.samples });
}

if (run('Q2')) {
  // 12 requêtes de 4 000 lignes chacune, simultanées, d'un seul compte ; pendant ce temps B charge
  // sa session (`/api/auth/me` : une requête SQL par le pool, sans limite de débit) et la boucle est sondée.
  const cards = Array.from({ length: 4000 }, (_, i) => ({ card_id: i + 1, zone: 'main', copies: 1 }));
  const c = cfg({ name: 'rafale', cards });
  const baseline = await req('GET', '/api/auth/me', { cookie: B });
  const single = await req('POST', '/api/decks', { cookie: A, body: c });
  const meB = [], loop = []; let done = false;
  const t = performance.now();
  const burst = Promise.all(Array.from({ length: 12 }, () => req('POST', '/api/decks', { cookie: A, body: c }))).then((r) => { done = true; return r; });
  const poll = (async () => { while (!done) { loop.push((await req('GET', '/api/auth/providers')).ms); meB.push(await req('GET', '/api/auth/me', { cookie: B })); } })();
  const rs = await burst; await poll;
  log('Q2', `12 × POST /api/decks (4 000 lignes, ${KiB(c)} Kio) simultanés ; B charge sa session pendant ce temps`, { seuleMs: single.ms, rafaleMs: Math.round(performance.now() - t), statuts: [...new Set(rs.map((x) => x.status))], dureesMs: rs.map((x) => x.ms), meB_avantMs: baseline.ms, meB_pendant: { n: meB.length, maxMs: Math.max(0, ...meB.map((x) => x.ms)), statuts: [...new Set(meB.map((x) => x.status))] }, boucleMaxMs: Math.max(0, ...loop) });
}

if (run('Q3')) {
  // Paires : la vérification d'identité fait un `find` par paire sur les paires existantes (decks.ts:128-132),
  // synchrone, avant toute écriture. On mesure la latence de la boucle pendant le second enregistrement.
  const n = 6000;
  const pairs = Array.from({ length: n }, (_, i) => ({ id: randomUUID(), card_a_id: 2 * i + 1, card_b_id: 2 * i + 2, note: null, disabled: false }));
  const c = cfg({ name: 'paires', pairs });
  const created = await req('POST', '/api/decks', { cookie: A, body: c });
  const m = await during(req('PUT', `/api/decks/${created.body.id}`, { cookie: A, body: { configuration: c, expectedRevision: 1 } }));
  log('Q3', `${n} paires (${KiB(c)} Kio) : création puis ré-enregistrement identique`, { creation: { status: created.status, ms: created.ms }, put: { status: m.r.status, ms: m.r.ms }, loopMaxMs: m.loopMaxMs, dbMaxMs: m.dbMaxMs, samples: m.samples });
}

if (run('Q4')) {
  // Import : deux requêtes SQL par HOPT (decks.ts:63-67), verrou `users … for update` tenu (decks.ts:43).
  const hopt = Array.from({ length: 20000 }, (_, i) => i + 1);
  const archive = { format: 'ygo-proba-deck', version: 2, configuration: cfg({ name: 'import' }), library: { hoptCardIds: hopt, categories: [], cardCategories: [], profiles: [], groups: [] } };
  const t = performance.now();
  const imp = req('POST', '/api/decks/import', { cookie: A, body: archive });
  // Pendant l'import, A essaie une écriture de bibliothèque (même verrou de compte).
  await new Promise((r) => setTimeout(r, 1500));
  const flag = await req('PUT', '/api/library/flags/999999', { cookie: A, body: { is_hopt: true } });
  const r = await imp;
  log('Q4', `import : ${hopt.length} HOPT (${KiB(archive)} Kio)`, { status: r.status, ms: r.ms, ecritureBibliothequePendantImport: { status: flag.status, ms: flag.ms, finiApresImportMs: Math.round(performance.now() - t) } });
}

if (run('Q5')) {
  // Requêtes « simples » (sans pré-vol CORS) : sans JSON, forme d'un formulaire HTML.
  const decks = async () => (await req('GET', '/api/decks', { cookie: A })).body.length;
  const target = (await req('POST', '/api/decks', { cookie: A, body: cfg({ name: 'cible' }) })).body.id;
  const before = await decks();
  const plain = await req('POST', `/api/decks/${target}/duplicate`, { cookie: A, raw: '', headers: { 'content-type': 'text/plain' } });
  const form = await req('POST', `/api/decks/${target}/duplicate`, { cookie: A, raw: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const formEmpty = await req('POST', `/api/decks/${target}/duplicate`, { cookie: A, raw: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const none = await req('POST', `/api/decks/${target}/duplicate`, { cookie: A });
  const after = await decks();
  const logoutForm = await req('POST', '/api/auth/logout', { cookie: await login('d@audit.test'), raw: '', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  log('Q5', 'POST duplicate / logout sans JSON', { textPlainVide: [plain.status, plain.body], formulaireAvecChamp: [form.status, form.body], formulaireVide: [formEmpty.status, formEmpty.body], sansContentType: none.status, decksAvant: before, decksApres: after, logoutFormulaire: logoutForm.status });
}

if (run('Q6')) {
  const l1 = await req('POST', '/api/auth/login', { body: { email: 'c@audit.test', password: 'motdepasse-audit' } });
  const l2 = await req('POST', '/api/auth/login', { body: { email: 'c@audit.test', password: 'motdepasse-audit' } });
  await req('POST', '/api/auth/logout', { cookie: cookieOf(l1) });
  log('Q6', 'deux sessions de C, déconnexion de la première', { session1: (await req('GET', '/api/auth/me', { cookie: cookieOf(l1) })).status, session2: (await req('GET', '/api/auth/me', { cookie: cookieOf(l2) })).status });
}

if (run('Q7')) {
  // Accès anonyme par le chemin encodé : routes du catalogue (aucun requireUser dans cards.ts).
  const p = {};
  for (const path of ['/api/cards/search?q=audit', '/%61pi/cards/search?q=audit&limit=100', '/%61pi/cards?ids=900000001,900000002', '/%61pi/cards/abc/image', '/%61pi/library', '/%61pi/decks']) {
    const r = await req('GET', path);
    p[path] = { status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 220) };
  }
  log('Q7', 'SANS session : catalogue par /%61pi/', p);
}

if (run('Q9')) {
  // Re-vérification des résultats tronqués du premier passage (P3 delete, P5 aperçu, P5 limit).
  const d = await req('POST', '/api/decks', { cookie: A, body: cfg({ name: 'Deck de A', cards: [{ card_id: 7, zone: 'main', copies: 3 }] }) });
  const del = await req('DELETE', `/api/decks/${d.body.id}`, { cookie: B });
  const reread = await req('GET', `/api/decks/${d.body.id}`, { cookie: A });
  const forged = await req('PUT', `/api/decks/${d.body.id}/summary`, { cookie: A, body: { expectedRevision: 1, summary: { engineVersion: 'n-importe-quoi', mainSize: 3, startRateFirst: 1, brickRate: 0, computedAt: '2030-01-01T00:00:00Z' } } });
  const list = await req('GET', '/api/decks', { cookie: A });
  const neg = await req('GET', '/api/cards/search?q=audit&limit=-1', { cookie: A });
  const frac = await req('GET', '/api/cards/search?q=audit&limit=0.5', { cookie: A });
  log('Q9', 'relectures', { deleteParB: [del.status, del.body], deckRelePourA: [reread.status, reread.body?.name], apercuForge: forged.status, apercuRelu: list.body.find((x) => x.id === d.body.id)?.summary, limitNegatif: [neg.status, neg.body], limitFraction: [frac.status, frac.body] });
}

if (run('Q8')) {
  const big = 'N'.repeat(100 * 1024);
  const r = await req('POST', '/api/auth/register', { body: { email: 'nom-long@audit.test', password: 'motdepasse-audit', invite_code: 'audit04', display_name: big } });
  const me = r.status === 201 ? await req('GET', '/api/auth/me', { cookie: cookieOf(r) }) : null;
  log('Q8', 'inscription avec un nom affiché de 100 Kio', { status: r.status, body: r.status === 201 ? '(compte créé)' : r.body, longueurRelue: me?.body?.user?.display_name?.length });
}
