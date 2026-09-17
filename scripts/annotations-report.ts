#!/usr/bin/env node
// Rapport d'inventaire des annotations par défaut (docs/annotations-par-defaut.md, partie A).
//
//   node --import tsx scripts/annotations-report.ts --db <url jetable> [--out <rapport.md>] [--gap]
//
// Lit le catalogue, les cartes de main des decks et les annotations des comptes d'une base
// JETABLE (hôte 127.0.0.1, port explicite différent de 5433 : la base de dev est interdite) et
// mesure la détection de `server/src/domain/cardDefaults.ts` :
//   1. classes HOPT et gabarits non-engine sur le catalogue entier ;
//   2. sur les cartes réellement jouées (main deck), accord entre la détection HOPT et les choix
//      existants (`card_flags.is_hopt`), et profils proposés face aux étiquettes existantes.
//   3. --gap (partie C, D9) : rapport d'écart par deck, sur une base migrée jusqu'à 006 (marqueur
//      « 006-annotation-defaults/c » journalisé, refus clair sinon). Pour chaque deck, P(≥ 1 départ),
//      brick et E[U] en premier et en second, AVANT (bibliothèque du compte = choix seuls :
//      `is_hopt = true`, profils matérialisés) et APRÈS (bibliothèque effective de
//      `web/src/lib/effectiveLibrary.ts` : choix > référence > détection sur le texte des cartes),
//      avec l'écart et les cartes du main dont la valeur change. Même moteur des deux côtés.
// Aucune écriture. Le rapport ne cite que des cartes, des noms de decks et des comptages : jamais
// d'email, de nom de compte ni d'identifiant de compte (les comptes sont numérotés dans l'ordre de
// création, les decks aussi).
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { cardDefaults, detectHopt, detectNonEngine, type CardText, type HoptKind } from '../server/src/domain/cardDefaults.js';
import { parseConfiguration } from '../server/src/domain/deckConfiguration.js';
import { computePass, type PassResult } from '../web/src/engine/index.js';
import { effectiveOf } from '../web/src/lib/effectiveLibrary.js';
import { buildEngineModel, type EngineModelSource } from '../web/src/lib/engineModel.js';
import { libraryState, stateFromConfiguration, withEffective } from '../web/src/lib/deckConfiguration.js';
import { AVAILABILITY_LABEL, type Availability, type Card, type CardProfile, type Library } from '../web/src/types.js';

// `web/src/lib/summary.ts` (atteint par les types de l'API) lit la version injectée par Vite ;
// hors Vite elle n'existe pas (le module retombe sur « unversioned »).
declare global { const __ENGINE_VERSION__: string | undefined }

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function usage(message: string): never { console.error(`annotations-report : ${message}`); process.exit(2); }
const raw = option('--db');
if (!raw) usage('--db <url> requis');
let url: URL;
try { url = new URL(raw); } catch { usage(`--db : URL invalide (${raw})`); }
if (url!.protocol !== 'postgres:' && url!.protocol !== 'postgresql:') usage('--db : URL postgres:// attendue');
if (url!.hostname !== '127.0.0.1') usage(`--db : hôte ${url!.hostname} refusé, seule une base jetable sur 127.0.0.1 est admise`);
if (!url!.port || url!.port === '5433') usage('--db : port explicite différent de 5433 requis, la base de dev (5433) est interdite');
const outFile = option('--out');
const gap = args.includes('--gap');

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
interface CardRow extends CardText { id: number }
interface PlayedRow { card_id: number; decks: number; max_copies: number }
interface FlagRow { owner: number; card_id: number; is_hopt: boolean | null; availability: string | null }
interface LabelRow { owner: number; card_id: number; name: string }

const lines: string[] = [];
const out = (s = ''): void => { lines.push(s); };
const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)} %`);

// ─── 4. Rapport d'écart par deck (--gap, D9) ───
type Uuid = string;
interface Metrics { start: number; brick: number; meanU: number }
interface PassPair { first: Metrics | string; second: Metrics | string }
const EPS = 1e-12;
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const pp = (x: number): string => `${(100 * x).toFixed(2)} %`;
const dpp = (x: number): string => (Math.abs(x) < EPS ? '·' : `${x > 0 ? '+' : '−'}${(100 * Math.abs(x)).toFixed(2)}`);
const dnum = (x: number): string => (Math.abs(x) < EPS ? '·' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`);

/** Grandeurs du panneau pour une passe : P(≥ 1 départ) = cumulé « au moins 1 » (summary.ts), brick, E[U]. */
function metricsOf(pass: PassResult): Metrics | string {
  if (pass.unavailableReason) return pass.unavailableReason;
  if (pass.total === 0) return 'passe vide';
  const b = pass.startsBuckets;
  return { start: (b[1] ?? 0) + (b[2] ?? 0) + (b[3] ?? 0), brick: pass.brick, meanU: pass.meanNonEngine };
}
function passesOf(source: EngineModelSource): PassPair {
  try {
    const input = buildEngineModel(source).input;
    return { first: metricsOf(computePass(input, 'first')), second: metricsOf(computePass(input, 'second')) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { first: reason, second: reason };
  }
}

async function gapReport(client: pg.Client, catalog: CardRow[]): Promise<void> {
  const q = async <T extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> => (await client.query<T>(text, params as never)).rows;
  const journaled = (await q<{ r: string | null }>("select to_regclass('app_migrations') as r"))[0].r !== null
    && (await q("select 1 from app_migrations where id = '006-annotation-defaults/c'")).length === 1;
  if (!journaled || (await q<{ r: string | null }>("select to_regclass('card_references') as r"))[0].r === null) {
    console.error('annotations-report : --gap exige une base migrée jusqu\'à 006 (marqueur « 006-annotation-defaults/c » journalisé, table card_references) ; appliquer la séquence de migrations sur la base jetable d\'abord');
    process.exit(2);
  }
  const cards: Record<number, Card> = {};
  for (const c of catalog) cards[c.id] = { id: c.id, name: c.name, type: c.type, race: c.race, description: c.description };
  const nameOf = (id: number): string => cards[id]?.name ?? `#${id}`;

  const owners = new Map((await q<{ id: Uuid; n: number }>('select id, dense_rank() over (order by created_at, id)::int as n from users')).map((u) => [u.id, u.n]));
  const references = (await q<{ card_id: number; is_hopt: boolean | null; nonengine_set: boolean; availability: Availability | null; group_name: string | null; note: string | null }>(
    'select card_id, is_hopt, nonengine_set, availability, group_name, note from card_references order by card_id'));
  /** Bibliothèque du compte à la forme de `GET /api/library` (choix seuls, références communes). */
  const libraries = new Map<Uuid, Library>();
  const libraryOf = async (owner: Uuid): Promise<Library> => {
    const cached = libraries.get(owner);
    if (cached) return cached;
    const flags = await q<{ card_id: number; is_hopt: boolean | null; nonengine_choice: boolean; availability: Availability | null; group_id: Uuid | null }>(
      'select card_id, is_hopt, nonengine_choice, availability, group_id from card_flags where owner_id = $1 and (is_hopt is not null or nonengine_choice or availability is not null) order by card_id', [owner]);
    const lib: Library = {
      hoptCardIds: flags.filter((f) => f.is_hopt === true).map((f) => f.card_id),
      categories: await q('select id, name, is_builtin from nonengine_categories where owner_id = $1 order by is_builtin desc, name, id', [owner]),
      cardCategories: await q('select cc.card_id, cc.category_id from card_categories cc join nonengine_categories c on c.id = cc.category_id where c.owner_id = $1', [owner]),
      profiles: flags.filter((f) => f.availability !== null).map((f) => ({ card_id: f.card_id, availability: f.availability!, group_id: f.group_id })),
      groups: await q('select id, name, cap_per_turn, is_builtin from nonengine_groups where owner_id = $1 order by is_builtin desc, name, id', [owner]),
      choices: flags.map((f) => ({ card_id: f.card_id, is_hopt: f.is_hopt, nonengine_choice: f.nonengine_choice })),
      references,
      referencesVersion: '0',
    };
    libraries.set(owner, lib);
    return lib;
  };

  interface Row {
    n: number; owner: number; name: string; mainSize: number;
    before: PassPair; after: PassPair; changes: string[]; error?: string;
  }
  const rows: Row[] = [];
  const decks = await q<{ id: Uuid; owner_id: Uuid; name: string; notes: string | null }>('select id, owner_id, name, notes from decks order by created_at, id');
  for (const [i, deck] of decks.entries()) {
    const owner = owners.get(deck.owner_id) ?? 0;
    const deckCards = await q<{ card_id: number; zone: string; copies: number }>('select card_id, zone, copies from deck_cards where deck_id = $1 order by zone, card_id', [deck.id]);
    const base: Row = { n: i + 1, owner, name: deck.name, mainSize: deckCards.filter((c) => c.zone === 'main').reduce((s, c) => s + c.copies, 0), before: { first: '—', second: '—' }, after: { first: '—', second: '—' }, changes: [] };
    let deckState: ReturnType<typeof stateFromConfiguration>;
    try {
      const flags = await q<{ card_id: number; dead_first: boolean; dead_second: boolean }>('select card_id, dead_first, dead_second from deck_flags where deck_id = $1 order by card_id', [deck.id]);
      deckState = stateFromConfiguration(parseConfiguration({
        version: 2, name: deck.name, cards: deckCards,
        starters: (await q<{ card_id: number }>('select card_id from deck_starters where deck_id = $1 order by card_id', [deck.id])).map((r) => r.card_id),
        pairs: await q('select id, card_a_id, card_b_id, note, disabled from deck_combo_pairs where deck_id = $1 order by card_a_id, card_b_id', [deck.id]),
        conditions: await q('select id, source_card_id, source_pair_id, condition from deck_conditions where deck_id = $1 order by id', [deck.id]),
        deadFirst: flags.filter((f) => f.dead_first).map((f) => f.card_id),
        deadSecond: flags.filter((f) => f.dead_second).map((f) => f.card_id),
        // Adversaires, paramètres et notes n'entrent pas dans le modèle moteur (contrat §2).
        matchups: [], params: {}, notes: null,
      }));
    } catch (err) {
      rows.push({ ...base, error: `configuration illisible : ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    const lib = libraryState(await libraryOf(deck.owner_id));
    // AVANT : `libraryState` sans fusion — `hopt` = choix `true`, `profiles` = profils matérialisés.
    const beforeSource = { ...deckState, ...lib };
    // APRÈS : même chemin que `sourceFromDetail` (fusion sur les cartes des trois zones, le moteur ne lit que le main).
    const ids = [...deckState.main, ...deckState.extra, ...deckState.side].map((c) => c.cardId);
    const afterSource = withEffective(beforeSource, cards, ids);
    const groupName = (p: CardProfile | undefined): string => (p?.groupId ? lib.groups.find((g) => g.id === p.groupId)?.name ?? 'plafond inconnu' : '');
    const profileText = (p: CardProfile | undefined): string => (p ? `${AVAILABILITY_LABEL[p.availability]}${groupName(p) ? ` + ${groupName(p)}` : ''}` : 'aucun profil');
    const origin = { choice: 'choix', reference: 'référence', detection: 'détection' } as const;
    for (const c of deckState.main) {
      const o = effectiveOf(lib, c.cardId, cards[c.cardId]).origin;
      const was = beforeSource.hopt.has(c.cardId), is = afterSource.hopt.has(c.cardId);
      if (was !== is) base.changes.push(`${cell(nameOf(c.cardId))} ×${c.copies} : HOPT ${is ? 'oui' : 'non'}${o.hopt ? ` (${origin[o.hopt]})` : ''}`);
      const pb = beforeSource.profiles.get(c.cardId), pa = afterSource.profiles.get(c.cardId);
      if (profileText(pb) !== profileText(pa)) base.changes.push(`${cell(nameOf(c.cardId))} ×${c.copies} : ${profileText(pb)} → ${profileText(pa)}${o.nonengine ? ` (${origin[o.nonengine]})` : ''}`);
    }
    rows.push({ ...base, before: passesOf(beforeSource), after: passesOf(afterSource) });
  }

  const delta = (r: Row, pos: 'first' | 'second', k: keyof Metrics): number | null => {
    const b = r.before[pos], a = r.after[pos];
    return typeof b === 'string' || typeof a === 'string' ? null : a[k] - b[k];
  };
  const moved = (r: Row): boolean => (['first', 'second'] as const).some((pos) => (['start', 'brick', 'meanU'] as const).some((k) => { const d = delta(r, pos, k); return d === null || Math.abs(d) >= EPS; }));
  const label = (r: Row): string => `D${r.n} · ${cell(r.name)}`;

  out('## 4. Rapport d\'écart par deck (D9)');
  out();
  out(`${rows.length} deck(s) · ${references.length} référence(s) commune(s). **Avant** = bibliothèque du compte, choix seuls (\`is_hopt = true\`, profils matérialisés) ; **après** = bibliothèque effective (choix > référence > détection). Même moteur des deux côtés (porte profil / étiquette levée) : l'écart ne vient que des annotations par défaut. Écarts en points de pourcentage (E[U] en unités) ; « · » = zéro exact (< 1e-12). Decks numérotés dans l'ordre de création, comptes comme au § 2.`);
  out();
  const unchanged = rows.filter((r) => !r.error && !moved(r));
  const failed = rows.filter((r) => r.error || (['first', 'second'] as const).some((pos) => typeof r.before[pos] === 'string' || typeof r.after[pos] === 'string'));
  const extreme = (pos: 'first' | 'second', k: keyof Metrics): string => {
    let best: Row | null = null, bestD = 0;
    for (const r of rows) { const d = delta(r, pos, k); if (d !== null && Math.abs(d) > Math.abs(bestD)) { best = r; bestD = d; } }
    return best ? `${k === 'meanU' ? dnum(bestD) : dpp(bestD)} (${label(best)})` : '·';
  };
  out(`- Decks inchangés (six grandeurs identiques) : ${unchanged.length} / ${rows.length}${unchanged.length ? ` — ${unchanged.map(label).join(', ')}` : ''}.`);
  out(`- Decks non calculés : ${failed.length}${failed.length ? ` — ${failed.map((r) => `${label(r)} (${r.error ?? [r.before.first, r.before.second, r.after.first, r.after.second].find((m) => typeof m === 'string')})`).join(' ; ')}` : ''}.`);
  for (const pos of ['first', 'second'] as const) {
    out(`- Plus grands écarts en ${pos === 'first' ? 'premier' : 'second'} : P(≥ 1 départ) ${extreme(pos, 'start')} · brick ${extreme(pos, 'brick')} · E[U] ${extreme(pos, 'meanU')}.`);
  }
  out();

  const sorted = [...rows].sort((a, b) => Math.abs(delta(b, 'first', 'start') ?? Infinity) - Math.abs(delta(a, 'first', 'start') ?? Infinity) || Math.abs(delta(b, 'first', 'meanU') ?? 0) - Math.abs(delta(a, 'first', 'meanU') ?? 0) || a.n - b.n);
  const show = (m: Metrics | string, k: keyof Metrics): string => (typeof m === 'string' ? '—' : k === 'meanU' ? m[k].toFixed(3) : pp(m[k]));
  for (const pos of ['first', 'second'] as const) {
    out(`### ${pos === 'first' ? 'Premier (5 cartes)' : 'Second (5 cartes + pioche)'}`);
    out();
    out('| Deck | Compte | Main | P(≥ 1) avant | après | Δ pts | Brick avant | après | Δ pts | E[U] avant | après | Δ |');
    out('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of sorted) {
      const b = r.before[pos], a = r.after[pos];
      const d = (k: keyof Metrics): string => { const x = delta(r, pos, k); return x === null ? '—' : k === 'meanU' ? dnum(x) : dpp(x); };
      out(`| ${label(r)} | ${r.owner} | ${r.mainSize} | ${show(b, 'start')} | ${show(a, 'start')} | ${d('start')} | ${show(b, 'brick')} | ${show(a, 'brick')} | ${d('brick')} | ${show(b, 'meanU')} | ${show(a, 'meanU')} | ${d('meanU')} |`);
    }
    out();
  }

  out('### Cartes du main dont la valeur effective change');
  out();
  out('| Deck | Changements (origine de la valeur après) |');
  out('| --- | --- |');
  for (const r of sorted) out(`| ${label(r)} | ${r.changes.length ? r.changes.join(' ; ') : '—'} |`);
  out();
}

const client = new pg.Client({ connectionString: url!.toString() });
await client.connect();
try {
  const cards = (await client.query<CardRow>('select id, name, type, race, description from cards order by id')).rows;
  const played = (await client.query<PlayedRow>("select card_id, count(distinct deck_id)::int as decks, max(copies)::int as max_copies from deck_cards where zone = 'main' group by card_id order by decks desc, card_id")).rows;
  const owners = "(select id, dense_rank() over (order by created_at, id)::int as n from users)";
  // Une archive antérieure à la migration 002 n'a pas de colonne `availability`.
  const hasAvailability = (await client.query("select 1 from information_schema.columns where table_name = 'card_flags' and column_name = 'availability'")).rowCount === 1;
  const flags = (await client.query<FlagRow>(`select u.n as owner, f.card_id, f.is_hopt, ${hasAvailability ? 'f.availability' : 'null::text as availability'} from card_flags f join ${owners} u on u.id = f.owner_id`)).rows;
  const labels = (await client.query<LabelRow>(`select u.n as owner, cc.card_id, c.name from card_categories cc join nonengine_categories c on c.id = cc.category_id join ${owners} u on u.id = c.owner_id`)).rows;
  const byId = new Map(cards.map((c) => [c.id, c]));

  out('# Annotations par défaut — rapport d\'inventaire');
  out();
  out(`Base : ${url!.hostname}:${url!.port}/${url!.pathname.slice(1)} · ${cards.length} cartes · ${played.length} cartes de main jouées · ${new Set(flags.map((f) => f.owner)).size} compte(s) avec drapeaux.`);
  out();

  // 1. Catalogue
  const kinds: Record<HoptKind, number> = { byName: 0, summonOnce: 0, byName2: 0, soft: 0, none: 0, excluded: 0 };
  const templates = new Map<string, number>();
  for (const c of cards) {
    kinds[detectHopt(c).kind]++;
    const ne = detectNonEngine(c);
    if (ne) templates.set(`${ne.template} → ${ne.availability}${ne.group ? ` + plafond ${ne.group}` : ''}`, (templates.get(`${ne.template} → ${ne.availability}${ne.group ? ` + plafond ${ne.group}` : ''}`) ?? 0) + 1);
  }
  out('## 1. Catalogue entier');
  out();
  out('| Classe HOPT | Cartes | HOPT par défaut |');
  out('| --- | --- | --- |');
  for (const [k, n] of Object.entries(kinds)) out(`| ${k} | ${n} | ${k === 'byName' ? 'oui' : 'non'} |`);
  out();
  out('| Gabarit non-engine → profil | Cartes |');
  out('| --- | --- |');
  for (const [k, n] of [...templates.entries()].sort((a, b) => b[1] - a[1])) out(`| ${k} | ${n} |`);
  out();

  // 2. Cartes jouées
  out('## 2. Cartes de main réellement jouées');
  out();
  const choice = new Map<string, boolean | null>();
  for (const f of flags) choice.set(`${f.owner}:${f.card_id}`, f.is_hopt);
  const ownersSeen = [...new Set(flags.map((f) => f.owner))].sort((a, b) => a - b);
  const matrix = new Map<string, number>();
  const disagreements: string[] = [];
  let covered = 0;
  let unknown = 0;
  let multiCopyHopt = 0;
  for (const p of played) {
    const c = byId.get(p.card_id);
    if (!c) { unknown++; continue; }
    const d = cardDefaults(c);
    const kind = detectHopt(c).kind;
    if (d.isHopt) covered++;
    if (d.isHopt && p.max_copies >= 2) multiCopyHopt++;
    for (const o of ownersSeen) {
      const ch = choice.get(`${o}:${p.card_id}`);
      const key = `${d.isHopt ? 'HOPT' : 'pas HOPT'} / compte ${o} : ${ch === undefined || ch === null ? 'aucun choix' : ch ? 'vrai' : 'faux'}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);
      if (ch !== undefined && ch !== null && ch !== d.isHopt) disagreements.push(`- compte ${o} · ${c.name} (${p.decks} deck(s), ${p.max_copies} ex. max) : détection ${kind}${d.isHopt ? ' (HOPT)' : ''}, choix ${ch ? 'vrai' : 'faux'}`);
    }
  }
  out(`Cartes jouées : ${played.length} (${unknown} absente(s) du catalogue) · HOPT par défaut : ${covered} (${pct(covered, played.length - unknown)}) · dont à 2 exemplaires ou plus : ${multiCopyHopt}.`);
  out();
  out('| Détection / choix du compte | Cartes |');
  out('| --- | --- |');
  for (const [k, n] of [...matrix.entries()].sort()) out(`| ${k} | ${n} |`);
  out();
  out('Désaccords (détection ≠ choix explicite) :');
  out();
  for (const d of disagreements) out(d);
  if (disagreements.length === 0) out('- aucun');
  out();

  // 3. Profils proposés sur les cartes jouées, face aux étiquettes existantes
  out('## 3. Profils non-engine proposés sur les cartes jouées');
  out();
  const labelsOf = new Map<number, Set<string>>();
  for (const l of labels) { if (!labelsOf.has(l.card_id)) labelsOf.set(l.card_id, new Set()); labelsOf.get(l.card_id)!.add(l.name); }
  const profileOf = new Map<number, Set<string>>();
  for (const f of flags) if (f.availability) { if (!profileOf.has(f.card_id)) profileOf.set(f.card_id, new Set()); profileOf.get(f.card_id)!.add(f.availability); }
  out('| Carte | Decks | Gabarit → profil proposé | Étiquettes existantes | Profils existants |');
  out('| --- | --- | --- | --- | --- |');
  for (const p of played) {
    const c = byId.get(p.card_id);
    if (!c) continue;
    const ne = detectNonEngine(c);
    const existing = labelsOf.get(p.card_id);
    const prof = profileOf.get(p.card_id);
    if (!ne && !existing && !prof) continue;
    out(`| ${c.name} | ${p.decks} | ${ne ? `${ne.template} → ${ne.availability}${ne.group ? ` + ${ne.group}` : ''}` : '—'} | ${existing ? [...existing].sort().join(', ') : '—'} | ${prof ? [...prof].sort().join(', ') : '—'} |`);
  }
  out();

  if (gap) await gapReport(client, cards);
} finally {
  await client.end();
}
const report = lines.join('\n') + '\n';
if (outFile) writeFileSync(outFile, report);
process.stdout.write(report);
