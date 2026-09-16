// Charge à débit imposé (boucle ouverte), audit 05. Usage : node paced.mjs <base> <req/s> <durée_s>
// Modèle d'un utilisateur actif (hypothèse, pas une mesure d'usage) : 1 requête toutes les 4 s en moyenne,
// dont 1 enregistrement complet de deck par minute ; les clics d'annotation écrivent immédiatement la
// bibliothèque (PUT /api/library/flags/:cardId). Répartition par type :
//   enregistrement 7 % · écriture bibliothèque 25 % · recherche 25 % · ouverture d'un deck 10 %
//   · bibliothèque 10 % · liste des decks 10 % · session 13 %
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const [base, rateArg, durArg] = process.argv.slice(2);
const rate = Number(rateArg);
const durMs = Number(durArg) * 1000;
const url = new URL(base);
const agent = new http.Agent({ keepAlive: true, maxSockets: 2000 });
const USERS = 1000;

function request(method, path, { cookie, body } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: url.hostname, port: url.port, method, path, agent,
      headers: { ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - t0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, ms: performance.now() - t0, body: String(e) }));
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

const uuid = () => crypto.randomUUID();
function configuration(seed) {
  const base = 20000000 + seed * 100;
  const cards = [];
  for (let i = 0; i < 20; i++) cards.push({ card_id: base + i, zone: 'main', copies: 2 });
  for (let i = 0; i < 15; i++) cards.push({ card_id: base + 20 + i, zone: 'extra', copies: 1 });
  for (let i = 0; i < 10; i++) cards.push({ card_id: base + 40 + i, zone: 'side', copies: 1 });
  const pairs = [];
  for (let i = 8; i < 18; i++) pairs.push({ id: uuid(), card_a_id: base + i, card_b_id: base + i + 1, note: null, disabled: false });
  const conditions = [0, 1, 2, 3].map((i) => ({ id: uuid(), source_card_id: base + i, source_pair_id: null, condition: { kind: 'and', all: [{ kind: 'remaining', card_id: base + 10 + i, at_least: 1 }] } }));
  const matchups = [0, 1, 2, 3, 4].map((m) => ({ id: uuid(), name: `Adversaire ${m}`, sort_index: m, plans: ['first', 'second'].map((position) => ({ position, note: null,
    outgoing: [0, 1, 2].map((k) => ({ card_id: base + k, copies: 1 })), incoming: [0, 1, 2].map((k) => ({ card_id: base + 40 + k, copies: 1 })) })) }));
  return { version: 2, name: `Deck charge ${seed}`, cards, starters: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => base + i), pairs, conditions,
    deadFirst: [base + 19], deadSecond: [], matchups, params: { importance: 0.5 }, notes: null };
}

// Préparation : deck et révision de chaque compte (hors mesure).
const users = [];
for (let i = 0; i < USERS; i += 50) {
  await Promise.all(Array.from({ length: Math.min(50, USERS - i) }, async (_, k) => {
    const n = i + k;
    const cookie = `ygo_session=tok${n + 1}-1`;
    const r = await request('GET', '/api/decks', { cookie });
    const d = JSON.parse(r.body)[0];
    users[n] = { cookie, deckId: d.id, revision: d.revision, config: configuration(n), busy: false, hopt: false };
  }));
}

const TYPES = [
  ['PUT /api/decks/:id', 0.07], ['PUT /api/library/flags/:cardId', 0.25], ['GET /api/cards/search', 0.25],
  ['GET /api/decks/:id', 0.10], ['GET /api/library', 0.10], ['GET /api/decks', 0.10], ['GET /api/auth/me', 0.13],
];
const stats = new Map();
const record = (label, r) => {
  const s = stats.get(label) ?? { n: 0, err: 0, codes: {}, lat: [] };
  s.n++; s.codes[r.status] = (s.codes[r.status] ?? 0) + 1;
  if (r.status === 0 || r.status >= 500 || r.status === 401) s.err++;
  s.lat.push(r.ms); stats.set(label, s);
};
async function fire() {
  const u = users[Math.floor(Math.random() * USERS)];
  let x = Math.random();
  let type = TYPES[TYPES.length - 1][0];
  for (const [t, w] of TYPES) { if (x < w) { type = t; break; } x -= w; }
  switch (type) {
    case 'PUT /api/decks/:id': {
      if (u.busy) { type = 'GET /api/auth/me'; return record(type, await request('GET', '/api/auth/me', { cookie: u.cookie })); }
      u.busy = true;
      const r = await request('PUT', `/api/decks/${u.deckId}`, { cookie: u.cookie, body: { configuration: u.config, expectedRevision: u.revision } });
      if (r.status === 200) u.revision = JSON.parse(r.body).revision;
      else if (r.status === 409) { const d = await request('GET', `/api/decks/${u.deckId}`, { cookie: u.cookie }); try { u.revision = JSON.parse(d.body).revision; } catch { /* */ } }
      u.busy = false;
      return record(type, r);
    }
    case 'PUT /api/library/flags/:cardId': u.hopt = !u.hopt; return record(type, await request('PUT', `/api/library/flags/${10000001 + Math.floor(Math.random() * 14529)}`, { cookie: u.cookie, body: { is_hopt: u.hopt } }));
    case 'GET /api/cards/search': return record(type, await request('GET', `/api/cards/search?q=${encodeURIComponent('card ' + Math.random().toString(16).slice(2, 4))}`, { cookie: u.cookie }));
    case 'GET /api/decks/:id': return record(type, await request('GET', `/api/decks/${u.deckId}`, { cookie: u.cookie }));
    case 'GET /api/library': return record(type, await request('GET', '/api/library', { cookie: u.cookie }));
    case 'GET /api/decks': return record(type, await request('GET', '/api/decks', { cookie: u.cookie }));
    default: return record(type, await request('GET', '/api/auth/me', { cookie: u.cookie }));
  }
}

const inflight = new Set();
const t0 = performance.now();
let sent = 0;
await new Promise((done) => {
  const tick = setInterval(() => {
    const elapsed = performance.now() - t0;
    if (elapsed >= durMs) { clearInterval(tick); done(); return; }
    const due = Math.floor((elapsed / 1000) * rate) - sent;
    for (let i = 0; i < due; i++) { sent++; const p = fire().finally(() => inflight.delete(p)); inflight.add(p); }
  }, 5);
});
await Promise.all(inflight);
const elapsed = (performance.now() - t0) / 1000;
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))]) : null; };
const rows = [];
let all = [];
for (const [label, s] of stats) { all = all.concat(s.lat); rows.push({ label, n: s.n, p50: pct(s.lat, 0.5), p95: pct(s.lat, 0.95), p99: pct(s.lat, 0.99), max: Math.round(Math.max(...s.lat)), err: s.err, codes: s.codes }); }
console.log(JSON.stringify({ targetRps: rate, sent, seconds: Number(elapsed.toFixed(1)), overall: { p50: pct(all, 0.5), p95: pct(all, 0.95), p99: pct(all, 0.99) }, rows }));
agent.destroy();
