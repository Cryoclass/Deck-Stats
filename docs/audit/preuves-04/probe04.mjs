// Sondes de l'audit 04 (permissions) contre une pile JETABLE : API 8796, PostgreSQL 55460.
// Jamais contre la base de dev, la prod ou un service tiers (aucune route qui sort vers le CDN).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8796';
const OUT = process.argv[2];
const results = [];
const log = (id, what, data) => { results.push({ id, what, ...data }); console.log(id, what, JSON.stringify(data).slice(0, 400)); };

async function call(method, path, { body, cookie, raw, headers = {} } = {}) {
  const t0 = performance.now();
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 300); }
  return { status: res.status, body: json, ms: Math.round(performance.now() - t0), setCookie: res.headers.get('set-cookie') };
}
// Chemin brut, sans normalisation WHATWG (les `..` et `%2e` partent tels quels).
function rawGet(path, cookie) {
  return new Promise((resolve) => {
    const u = new URL(BASE);
    const req = http.request({ host: u.hostname, port: u.port, path, method: 'GET', headers: cookie ? { cookie } : {} }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 200) }));
    });
    req.on('error', (e) => resolve({ status: 'ERR', body: String(e) }));
    req.end();
  });
}
const cookieOf = (r) => (r.setCookie ?? '').split(';')[0];
const cfg = (over = {}) => ({ version: 2, name: 'Audit', cards: [], starters: [], pairs: [], conditions: [], deadFirst: [], deadSecond: [], matchups: [], params: {}, notes: null, ...over });
const sizeKiB = (o) => Math.round(Buffer.byteLength(JSON.stringify(o)) / 1024);

// ─── P1 inscription, code partagé et réutilisable, limite de débit ───
const reg = async (email, invite = 'audit04') => call('POST', '/api/auth/register', { body: { email, password: 'motdepasse-audit', invite_code: invite } });
const rA = await reg('a@audit.test'); const A = cookieOf(rA);
const rB = await reg('b@audit.test'); const B = cookieOf(rB);
const rC = await reg('c@audit.test');
const rBad = await reg('bad@audit.test', 'mauvais');
const rD = await reg('d@audit.test');
const rE = await reg('e@audit.test');
log('P1', 'inscriptions successives, même code, même IP', { A: rA.status, B: rB.status, C: rC.status, codeInvalide: rBad.status, D: rD.status, E_sixieme: rE.status, E_body: rE.body });
const me = await call('GET', '/api/auth/me', { cookie: A });
log('P1b', '/api/auth/me de A (aucun rôle, aucun plan)', { status: me.status, body: me.body });

// ─── P2 garde globale : variantes de chemin sans cookie ───
const paths = ['/api/decks', '/%61pi/decks', '//api/decks', '/api/decks/', '/API/decks', '/api/auth/../decks', '/api/auth/%2e%2e/decks', '/api/auth/%2E%2E/library', '/api/auth%2F..%2Fdecks'];
const p2 = {};
for (const p of paths) p2[p] = await rawGet(p);
log('P2', 'variantes de chemin SANS session', p2);
const p2b = {};
for (const p of ['/%61pi/decks', '/api/auth/%2e%2e/decks']) p2b[p] = await rawGet(p, A);
log('P2b', 'variantes de chemin AVEC session de A', p2b);

// ─── P3 isolation entre comptes (IDOR) ───
const deckA = await call('POST', '/api/decks', { cookie: A, body: cfg({ name: 'Deck de A', cards: [{ card_id: 14558127, zone: 'main', copies: 3 }] }) });
const idA = deckA.body.id;
const gA = await call('POST', '/api/library/groups', { cookie: A, body: { name: 'Plafond A', cap_per_turn: 1 } });
const cA = await call('POST', '/api/library/categories', { cookie: A, body: { name: 'Etiquette A' } });
const p3 = {
  get: (await call('GET', `/api/decks/${idA}`, { cookie: B })).status,
  put: (await call('PUT', `/api/decks/${idA}`, { cookie: B, body: { configuration: cfg(), expectedRevision: 1 } })).status,
  patch: (await call('PATCH', `/api/decks/${idA}`, { cookie: B, body: { name: 'volé' } })).status,
  duplicate: (await call('POST', `/api/decks/${idA}/duplicate`, { cookie: B })).status,
  summary: (await call('PUT', `/api/decks/${idA}/summary`, { cookie: B, body: { expectedRevision: 1, summary: { engineVersion: 'x', mainSize: 3, startRateFirst: 1, brickRate: 0, computedAt: new Date().toISOString() } } })).status,
  delete: await call('DELETE', `/api/decks/${idA}`, { cookie: B }),
  patchGroup: (await call('PATCH', `/api/library/groups/${gA.body.id}`, { cookie: B, body: { cap_per_turn: 99 } })).status,
  deleteGroup: (await call('DELETE', `/api/library/groups/${gA.body.id}`, { cookie: B })).status,
  deleteCategory: (await call('DELETE', `/api/library/categories/${cA.body.id}`, { cookie: B })).status,
  assignToCategoryOfA: (await call('POST', '/api/library/card-categories', { cookie: B, body: { card_id: 1, category_id: cA.body.id } })).status,
  flagWithGroupOfA: (await call('PUT', '/api/library/flags/1', { cookie: B, body: { group_id: gA.body.id } })).status,
  configRefCategoryOfA: await call('POST', '/api/decks', { cookie: B, body: cfg({ params: { statsView: cA.body.id } }) }),
};
const stillThere = await call('GET', `/api/decks/${idA}`, { cookie: A });
log('P3', 'B agit sur les ressources de A', { ...p3, delete: { status: p3.delete.status, body: p3.delete.body }, configRefCategoryOfA: { status: p3.configRefCategoryOfA.status, body: p3.configRefCategoryOfA.body }, deckA_apres: { status: stillThere.status, name: stillThere.body.name } });

// ─── P4 identifiants choisis par le client : collision entre comptes ───
const collideCat = await call('POST', '/api/library/categories', { cookie: B, body: { id: cA.body.id, name: 'Autre nom' } });
const collideGroup = await call('POST', '/api/library/groups', { cookie: B, body: { id: gA.body.id, name: 'Autre plafond', cap_per_turn: 2 } });
log('P4', 'B crée une catégorie / un plafond avec l’UUID de ceux de A', { categorie: { status: collideCat.status, body: collideCat.body }, plafond: { status: collideGroup.status, body: collideGroup.body } });

// ─── P5 valeurs absurdes acceptées ───
const bigNotes = 'x'.repeat(900 * 1024);
const p5 = {};
const n9 = await call('POST', '/api/decks', { cookie: A, body: cfg({ notes: bigNotes }) });
p5.notes900k = { status: n9.status, ms: n9.ms };
p5.name201 = (await call('POST', '/api/decks', { cookie: A, body: cfg({ name: 'n'.repeat(201) }) })).status;
p5.nameHtml = await call('POST', '/api/decks', { cookie: A, body: cfg({ name: '<img src=x onerror=alert(1)>‮evil' }) });
const junkSubject = { kind: 'starts', libre: { profond: { encore: 'a'.repeat(50000) } } };
const withJunk = await call('POST', '/api/decks', { cookie: A, body: cfg({ params: { importance: 1, savedQueries: [{ id: 'q', name: 'z'.repeat(100000), criteria: [{ id: 'c', min: 0, max: 9007199254740991, subject: junkSubject }] }] } }) });
const junkBack = withJunk.status === 201 ? await call('GET', `/api/decks/${withJunk.body.id}`, { cookie: A }) : null;
p5.savedQueriesJunk = { status: withJunk.status, champLibreRelu: junkBack ? Object.keys(junkBack.body.params.savedQueries[0].criteria[0].subject) : null, nomRequeteLongueur: junkBack?.body.params.savedQueries[0].name.length };
const huge = cfg({ cards: Array.from({ length: 1000 }, (_, i) => ({ card_id: 1000 + i, zone: 'main', copies: 3 })), starters: Array.from({ length: 1000 }, (_, i) => 1000 + i) });
const hugeDeck = await call('POST', '/api/decks', { cookie: A, body: huge });
p5.deck3000cartes1000starters = { status: hugeDeck.status, ms: hugeDeck.ms, KiB: sizeKiB(huge) };
p5.atLeast32767 = (await call('POST', '/api/decks', { cookie: A, body: cfg({ cards: [{ card_id: 5, zone: 'main', copies: 1 }], starters: [5], conditions: [{ id: randomUUID(), source_card_id: 5, source_pair_id: null, condition: { kind: 'remaining', card_id: 5, at_least: 32767 } }] }) })).status;
p5.cardIdMaxSafe = (await call('POST', '/api/decks', { cookie: A, body: cfg({ cards: [{ card_id: 9007199254740991, zone: 'main', copies: 1 }] }) })).status;
const m32 = await call('POST', '/api/decks', { cookie: A, body: cfg({ matchups: Array.from({ length: 32 }, (_, i) => ({ id: randomUUID(), name: 'Adv ' + i, sort_index: i, plans: [{ position: 'first', note: 'n'.repeat(20000), outgoing: [], incoming: [] }] })) }) });
p5.matchups32notes = { status: m32.status, ms: m32.ms };
p5.body1MiBplus = (await call('POST', '/api/decks', { cookie: A, body: cfg({ notes: 'x'.repeat(1024 * 1024 + 10) }) })).status;
// Aperçu falsifié : 100 % de départs, 0 % de brique, accepté pour la révision courante.
const small = await call('POST', '/api/decks', { cookie: A, body: cfg({ name: 'Aperçu falsifié', cards: [{ card_id: 7, zone: 'main', copies: 3 }] }) });
p5.summaryForged = (await call('PUT', `/api/decks/${small.body.id}/summary`, { cookie: A, body: { expectedRevision: 1, summary: { engineVersion: 'n-importe-quoi', mainSize: 3, startRateFirst: 1, brickRate: 0, computedAt: '2030-01-01T00:00:00Z' } } })).status;
const listed = await call('GET', '/api/decks', { cookie: A });
p5.summaryForgedRelu = listed.body.find((d) => d.id === small.body.id)?.summary;
p5.searchLimitNegative = await call('GET', '/api/cards/search?q=ab&limit=-1', { cookie: A });
p5.searchLimitFraction = await call('GET', '/api/cards/search?q=ab&limit=0.5', { cookie: A });
p5.cardsIds3000 = (await call('GET', '/api/cards?ids=' + Array.from({ length: 1500 }, (_, i) => 10000 + i).join(','), { cookie: A })).status;
log('P5', 'valeurs absurdes', { ...p5, nameHtml: { status: p5.nameHtml.status }, searchLimitNegative: { status: p5.searchLimitNegative.status, body: p5.searchLimitNegative.body }, searchLimitFraction: { status: p5.searchLimitFraction.status, body: p5.searchLimitFraction.body } });

// ─── P6 quotas : decks, catégories, plafonds en rafale ───
let t0 = performance.now(); let okDecks = 0, lastStatus = 0;
for (let i = 0; i < 300; i++) { const r = await call('POST', '/api/decks', { cookie: B, body: cfg({ name: `Rafale ${i}` }) }); lastStatus = r.status; if (r.status === 201) okDecks++; }
const decksMs = Math.round(performance.now() - t0);
t0 = performance.now(); let okCats = 0;
for (let i = 0; i < 500; i++) { const r = await call('POST', '/api/library/categories', { cookie: B, body: { name: `Cat ${i}` } }); if (r.status === 201) okCats++; }
const catsMs = Math.round(performance.now() - t0);
log('P6', 'rafales sans quota ni limite de débit', { decksCrees: okDecks, sur: 300, dernierStatut: lastStatus, decksMs, categoriesCreees: okCats, sur2: 500, catsMs });

// ─── P7 coût d'une requête maximale et blocage de la boucle d'événements ───
// Sonde de latence : /api/auth/providers ne touche pas la base (boucle seule), /api/health la touche (pool).
async function probeWhile(promise, label) {
  const loop = [], db = [];
  let done = false;
  const p = promise.then((r) => { done = true; return r; });
  const poll = (async () => {
    while (!done) {
      const a = await call('GET', '/api/auth/providers'); loop.push(a.ms);
      const b = await call('GET', '/api/health'); db.push(b.ms);
    }
  })();
  const r = await p; await poll;
  return { label, status: r.status, ms: r.ms, body: typeof r.body === 'object' ? r.body : String(r.body).slice(0, 120), latenceBoucleMaxMs: Math.max(0, ...loop), latenceBaseMaxMs: Math.max(0, ...db), sondes: loop.length };
}
// (a) deadFirst de ~1 Mio : ids distincts courts → `includes` quadratique dans writeConfiguration.
// Construction linéaire (octets comptés au fil de l'eau) : cible ≈ 1 000 000 octets de tableau.
const fill = (budget, sizeOf, make) => { const out = []; let bytes = 2; for (let i = 1; ; i++) { const s = sizeOf(i) + 1; if (bytes + s > budget) break; bytes += s; out.push(make(i)); } return out; };
const dead = fill(1_000_000, (i) => String(i).length, (i) => i);
const deadDeck = await call('POST', '/api/decks', { cookie: A, body: cfg({ name: 'dead' }) });
const deadCfg = cfg({ name: 'dead', deadFirst: dead });
const p7a = await probeWhile(call('PUT', `/api/decks/${deadDeck.body.id}`, { cookie: A, body: { configuration: deadCfg, expectedRevision: 1 } }), `PUT deadFirst ${dead.length} ids (${sizeKiB(deadCfg)} Kio)`);
log('P7a', 'requête maximale deadFirst', p7a);
// (b) cards de ~1 Mio : ids distincts, 1 copie, zone main → une insertion par ligne dans la transaction.
const cards = fill(1_000_000, (i) => `{"card_id":${i},"zone":"main","copies":1}`.length, (i) => ({ card_id: i, zone: 'main', copies: 1 }));
const cardsCfg = cfg({ name: 'cards', cards });
const p7b = await probeWhile(call('POST', '/api/decks', { cookie: A, body: cardsCfg }), `POST cards ${cards.length} lignes (${sizeKiB(cardsCfg)} Kio)`);
log('P7b', 'requête maximale cards', p7b);
// (c) 12 requêtes maximales simultanées d'UN compte : pool pg (10 connexions par défaut) saturé ?
const loginWhile = async () => {
  const lat = []; let done = false;
  const burst = Promise.all(Array.from({ length: 12 }, () => call('POST', '/api/decks', { cookie: A, body: cardsCfg }))).then((r) => { done = true; return r; });
  const poll = (async () => { while (!done) { const l = await call('POST', '/api/auth/login', { body: { email: 'b@audit.test', password: 'motdepasse-audit' } }); lat.push({ status: l.status, ms: l.ms }); } })();
  const t = performance.now(); const r = await burst; await poll;
  return { rafaleMs: Math.round(performance.now() - t), statuts: [...new Set(r.map((x) => x.status))], connexionsDeB: lat.length, connexionLaPlusLenteMs: Math.max(0, ...lat.map((x) => x.ms)), statutsConnexion: [...new Set(lat.map((x) => x.status))] };
};
log('P7c', '12 POST maximaux simultanés de A pendant que B se connecte', await loginWhile());
// (d) import : hoptCardIds de ~1 Mio → deux requêtes SQL par id, verrou `users for update` tenu.
const hopt = fill(950_000, (i) => String(i).length, (i) => i);
const archive = { format: 'ygo-proba-deck', version: 2, configuration: cfg({ name: 'import' }), library: { hoptCardIds: hopt, categories: [], cardCategories: [], profiles: [], groups: [] } };
const p7d = await probeWhile(call('POST', '/api/decks/import', { cookie: A, body: archive }), `POST import hoptCardIds ${hopt.length} (${sizeKiB(archive)} Kio)`);
log('P7d', 'import maximal', p7d);
const libA = await call('GET', '/api/library', { cookie: A });
log('P7e', 'bibliothèque de A après import', { status: libA.status, hopt: libA.body.hoptCardIds?.length, ms: libA.ms });

// ─── P8 requêtes « simples » (sans pré-vol CORS) sur les routes à effet ───
const beforeDup = (await call('GET', '/api/decks', { cookie: A })).body.length;
const dupPlain = await call('POST', `/api/decks/${idA}/duplicate`, { cookie: A, raw: '', headers: { 'content-type': 'text/plain' } });
const dupForm = await call('POST', `/api/decks/${idA}/duplicate`, { cookie: A, raw: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const dupNone = await call('POST', `/api/decks/${idA}/duplicate`, { cookie: A });
const afterDup = (await call('GET', '/api/decks', { cookie: A })).body.length;
log('P8', 'POST duplicate sans JSON (forme d’un formulaire HTML)', { textPlainVide: { status: dupPlain.status, body: dupPlain.body }, formulaire: { status: dupForm.status, body: dupForm.body }, sansCorps: { status: dupNone.status }, decksAvant: beforeDup, decksApres: afterDup });

// ─── P9 sessions : pas de déconnexion globale ───
const l1 = await call('POST', '/api/auth/login', { body: { email: 'c@audit.test', password: 'motdepasse-audit' } });
const l2 = await call('POST', '/api/auth/login', { body: { email: 'c@audit.test', password: 'motdepasse-audit' } });
await call('POST', '/api/auth/logout', { cookie: cookieOf(l1) });
log('P9', 'deux sessions de C, déconnexion de la première', { session1: (await call('GET', '/api/auth/me', { cookie: cookieOf(l1) })).status, session2: (await call('GET', '/api/auth/me', { cookie: cookieOf(l2) })).status });

if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
