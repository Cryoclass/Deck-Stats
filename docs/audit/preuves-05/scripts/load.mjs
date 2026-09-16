// Générateur de charge en boucle fermée (keep-alive), audit 05. Aucune dépendance.
// Usage : node load.mjs <base> <scénario> <concurrence> <durée_s> [options JSON]
// Chaque « utilisateur virtuel » i utilise la session tok<i+1>-1 (jeu synthétique gen-data.sql).
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const [base, scenario, concArg, durArg, optArg] = process.argv.slice(2);
const conc = Number(concArg);
const durMs = Number(durArg) * 1000;
// Options « clé=valeur;clé=valeur » (PowerShell 5.1 retire les guillemets d'un JSON passé à docker).
const opts = Object.fromEntries((optArg ?? '').split(';').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
const url = new URL(base);
const agent = new http.Agent({ keepAlive: true, maxSockets: conc + 8 });

function request(method, path, { cookie, body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: url.hostname, port: url.port, method, path, agent,
      headers: { ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: performance.now() - t0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, ms: performance.now() - t0, body: String(e) }));
    req.setTimeout(120_000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

const stats = new Map();
function record(label, r) {
  const s = stats.get(label) ?? { n: 0, errors: 0, codes: {}, lat: [] };
  s.n++;
  s.codes[r.status] = (s.codes[r.status] ?? 0) + 1;
  // Erreur = pas de réponse, 5xx, ou refus d'authentification (jeton synthétique invalide) ; 409 attendu en écriture concurrente.
  if (r.status === 0 || r.status >= 500 || r.status === 401 || r.status === 403) s.errors++;
  s.lat.push(r.ms);
  stats.set(label, s);
}

// Configuration réaliste d'un deck (≈ taille d'un deck compétitif annoté) pour PUT /decks/:id.
const uuid = () => crypto.randomUUID();
function realisticConfiguration(seed) {
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

async function userLoop(i, until) {
  const cookie = `ygo_session=tok${i + 1}-1`;
  let deckId = null;
  let revision = null;
  const config = realisticConfiguration(i);
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
  if (['deck', 'put', 'mix'].includes(scenario)) {
    const list = await request('GET', '/api/decks', { cookie });
    const decks = JSON.parse(list.body);
    deckId = decks[0].id;
    revision = decks[0].revision;
  }
  let loop = 0;
  while (performance.now() < until) {
    loop++;
    switch (scenario) {
      case 'health': record('GET /api/health', await request('GET', '/api/health')); break;
      case 'me': record('GET /api/auth/me', await request('GET', '/api/auth/me', { cookie })); break;
      case 'decks': record('GET /api/decks', await request('GET', '/api/decks', { cookie })); break;
      case 'deck': record('GET /api/decks/:id', await request('GET', `/api/decks/${deckId}`, { cookie })); break;
      case 'library': record('GET /api/library', await request('GET', '/api/library', { cookie })); break;
      case 'search': record(`GET /api/cards/search?q=${opts.q ?? 'ab'}`, await request('GET', `/api/cards/search?q=${encodeURIComponent(opts.q ?? 'ab')}`, { cookie })); break;
      case 'search-random': record('GET /api/cards/search?q=card <2 hex>', await request('GET', `/api/cards/search?q=${encodeURIComponent('card ' + Math.random().toString(16).slice(2, 4))}`, { cookie })); break;
      case 'flags': record('PUT /api/library/flags/:cardId', await request('PUT', `/api/library/flags/${10000001 + Math.floor(Math.random() * 14529)}`, { cookie, body: { is_hopt: loop % 2 === 0 } })); break;
      case 'put': {
        const r = await request('PUT', `/api/decks/${deckId}`, { cookie, body: { configuration: config, expectedRevision: revision } });
        record('PUT /api/decks/:id', r);
        if (r.status === 200) revision = JSON.parse(r.body).revision;
        else if (r.status === 409) { const d = await request('GET', `/api/decks/${deckId}`, { cookie }); revision = JSON.parse(d.body).revision; }
        break;
      }
      case 'login': {
        // Adresse distincte par requête (X-Forwarded-For, TRUST_PROXY=1, appel direct sans Caddy) :
        // mesure le coût du hachage, pas la limite de débit par IP.
        const r = await request('POST', '/api/auth/login', { body: { email: `absent${i}-${loop}@audit05.test`, password: 'mauvais-mot-de-passe' }, headers: { 'x-forwarded-for': `10.${i & 255}.${(loop >> 8) & 255}.${loop & 255}` } });
        record('POST /api/auth/login (email inconnu)', r);
        break;
      }
      case 'mix': {
        // Parcours d'un utilisateur actif sans temps de réflexion : ouvrir l'accueil, un deck, chercher, enregistrer.
        record('GET /api/auth/me', await request('GET', '/api/auth/me', { cookie }));
        record('GET /api/decks', await request('GET', '/api/decks', { cookie }));
        record('GET /api/library', await request('GET', '/api/library', { cookie }));
        record('GET /api/decks/:id', await request('GET', `/api/decks/${deckId}`, { cookie }));
        record('GET /api/cards/search', await request('GET', '/api/cards/search?q=card%20a', { cookie }));
        const r = await request('PUT', `/api/decks/${deckId}`, { cookie, body: { configuration: config, expectedRevision: revision } });
        record('PUT /api/decks/:id', r);
        if (r.status === 200) revision = JSON.parse(r.body).revision;
        else { const d = await request('GET', `/api/decks/${deckId}`, { cookie }); try { revision = JSON.parse(d.body).revision; } catch { /* */ } }
        break;
      }
      default: throw new Error(`scénario inconnu : ${scenario}`);
    }
  }
}

const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const t0 = performance.now();
const until = t0 + durMs;
await Promise.all(Array.from({ length: conc }, (_, i) => userLoop(i + (opts.offset ?? 0), until)));
const elapsed = (performance.now() - t0) / 1000;
const out = { scenario, concurrency: conc, seconds: Number(elapsed.toFixed(1)), rows: [] };
let total = 0;
for (const [label, s] of stats) {
  total += s.n;
  out.rows.push({ label, requests: s.n, rps: Number((s.n / elapsed).toFixed(1)), p50: Math.round(pct(s.lat, 0.5)), p95: Math.round(pct(s.lat, 0.95)), p99: Math.round(pct(s.lat, 0.99)), max: Math.round(Math.max(...s.lat)), errors: s.errors, codes: s.codes });
}
out.totalRps = Number((total / elapsed).toFixed(1));
console.log(JSON.stringify(out));
agent.destroy();
