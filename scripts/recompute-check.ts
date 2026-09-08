#!/usr/bin/env node
// Contrôle de recalcul après la migration 003 (étape 8B, point 4).
//
//   node --import tsx scripts/recompute-check.ts --db <url migrée> --old-db <url pré-migration> [--out <rapport>] [--tolerance 1e-9] [--reference-engine <dossier>]
//   node --import tsx scripts/recompute-check.ts --db <url> --fabricate
//
// Référence : l'ANCIEN moteur (commit e890078, celui de la production), matérialisé depuis
// l'historique git (`git show`) dans deploy/out/reference-engine-e890078/ (ignoré par git),
// recalcule chaque deck de la base PRÉ-MIGRATION (`--old-db`, restauration de l'archive
// pré-migration) avec l'ancien modèle : paires globales du compte, exclusions du deck,
// prérequis des deux sources, drapeaux dead_* du compte, pertinences, horizons. Le contrôle
// compare cette référence (brick de la passe premier, 5 cartes) à :
//   (a) le nouveau moteur sur le modèle v2 de la base MIGRÉE (`--db`) avec les paires globales
//       purgées réinjectées (non exclues, deux cartes dans le main) et leurs prérequis — attendu
//       identique à la tolérance près ;
//   (b) le nouveau moteur après purge — écart attribué aux paires purgées et chiffré (nul pour un
//       deck sans paire globale active ni prérequis source paire).
// mainSize doit être égal des deux côtés. Le résumé stocké (decks.summary de la base
// pré-migration) n'est qu'une colonne informative : « résumé stocké, possiblement périmé »
// (cache de la dernière sauvegarde, jamais invalidé par l'ancienne app quand les paires bougent ;
// recalculé à l'étape 9). Un deck hors tolérance en (a) est nommé « écart non expliqué » et le
// contrôle échoue ; aucune heuristique ne cherche à l'expliquer.
// --fabricate (jeu représentatif seulement, base PRÉ-001) : écrit dans decks.summary le résumé
// que l'ancienne app aurait enregistré, calculé par le moteur actuel sur le modèle historique.
// Garde : les bases doivent être des conteneurs jetables — hôte 127.0.0.1, port explicite
// différent de 5433 (base de dev interdite). Aucune écriture hors --fabricate. Le rapport ne cite
// que des identifiants internes, des noms de decks et des cartes : jamais d'email ni de nom de compte.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { computePass } from '../web/src/engine/index.js';
import { buildEngineModel, type EngineModelSource } from '../web/src/lib/engineModel.js';
import type { CardProfile, Category, ComboPair, DeckCard, NonEngineGroup, StartCondition } from '../web/src/types.js';
import type { Availability, ConditionNode } from '../server/src/domain/deckConfiguration.js';

// ─── Arguments ───
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_COMMIT = 'e890078';
const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name: string): boolean => args.includes(name);
function usage(message: string): never { console.error(`recompute-check : ${message}`); process.exit(2); }
function disposableUrl(raw: string | undefined, what: string): URL {
  if (!raw) usage(`${what} <url> requis`);
  let url: URL;
  try { url = new URL(raw); } catch { usage(`${what} : URL invalide (${raw})`); }
  if (url!.protocol !== 'postgres:' && url!.protocol !== 'postgresql:') usage(`${what} : URL postgres:// attendue`);
  if (url!.hostname !== '127.0.0.1') usage(`${what} : hôte ${url!.hostname} refusé, seule une base jetable sur 127.0.0.1 est admise`);
  if (!url!.port || url!.port === '5433') usage(`${what} : port explicite différent de 5433 requis, la base de dev (5433) est interdite`);
  return url!;
}
const newUrl = disposableUrl(option('--db'), '--db');
const fabricate = flag('--fabricate');
const oldUrl = fabricate ? null : disposableUrl(option('--old-db'), '--old-db');
const outFile = option('--out');
const tolerance = Number(option('--tolerance') ?? '1e-9');
if (!(tolerance > 0)) usage('--tolerance : nombre > 0 attendu');
const referenceDir = resolve(option('--reference-engine') ?? join(ROOT, 'deploy', 'out', `reference-engine-${REFERENCE_COMMIT}`));

// ─── Types des données lues ───
type Uuid = string;
interface DeckRow { id: Uuid; owner_id: Uuid; name: string; params: Record<string, unknown>; summary: OldSummary | null }
interface OldSummary { mainSize?: number; brickRate?: number; startRateFirst?: number }
interface LegacyPair { id: Uuid; owner_id: Uuid; card_a_id: number; card_b_id: number; note: string | null }
interface LegacyRequirement { id: Uuid; source_card_id: number | null; source_pair_id: Uuid | null; required_card_id: number; min_in_deck: number }
interface DeckState {
  main: DeckCard[]; starters: Set<number>; pairs: ComboPair[]; pairExclusions: Set<string>;
  startConditions: StartCondition[]; deadFirst: Set<number>; deadSecond: Set<number>;
}
interface Library {
  hopt: Set<number>; profiles: Map<number, CardProfile>; groups: NonEngineGroup[];
  categories: Category[]; cardCategories: Map<number, Set<string>>;
}
/** Modèle historique d'un deck, tel que l'ancienne app le construisait (base pré-001). */
interface LegacyModel {
  main: DeckCard[]; starters: Set<number>; pairs: LegacyPair[]; pairExclusions: Set<string>; requirements: LegacyRequirement[];
  hopt: Set<number>; deadFirst: Set<number>; deadSecond: Set<number>;
  categories: Array<{ id: string; name: string; relevance: string; is_builtin: boolean }>; cardCategories: Map<number, Set<string>>;
  horizonFirst: number; horizonSecond: number;
}
interface ReferenceEngine {
  computePass(input: unknown, handSize: number): { brick: number };
  buildEngineModel(source: unknown): { input: unknown; typeCardIds: number[] };
}

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
class Db {
  private readonly client: pg.Client;
  constructor(url: URL) { this.client = new pg.Client({ connectionString: url.toString() }); }
  async connect(): Promise<void> { await this.client.connect(); }
  end(): Promise<void> { return this.client.end(); }
  async q<T extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> { return (await this.client.query<T>(text, params as never)).rows; }
  async regclass(name: string): Promise<boolean> { return (await this.q<{ r: string | null }>('select to_regclass($1) as r', [name]))[0].r !== null; }
  async journaled(id: string): Promise<boolean> { return (await this.regclass('app_migrations')) && (await this.q('select 1 from app_migrations where id = $1', [id])).length === 1; }
}

/** Un groupe ET de feuilles « il reste ≥ min copies », dans l'ordre des identifiants (règle de 002). */
function andOf(reqs: LegacyRequirement[]): ConditionNode {
  const sorted = [...reqs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { kind: 'and', all: sorted.map((r) => ({ kind: 'remaining', card_id: r.required_card_id, at_least: r.min_in_deck })) };
}
const mainSizeOf = (main: DeckCard[]): number => main.reduce((s, c) => s + c.copies, 0);
const fmt = (x: number | null | undefined): string => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(12));
const fmtDelta = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(12)}`;
const pairLabel = (p: { card_a_id: number; card_b_id: number }): string => `${p.card_a_id}+${p.card_b_id}`;

// ─── Lecture des bases ───
async function loadMain(db: Db, deckId: Uuid): Promise<DeckCard[]> {
  return (await db.q<{ card_id: number; copies: number }>("select card_id, copies from deck_cards where deck_id = $1 and zone = 'main' order by card_id", [deckId]))
    .map((c) => ({ cardId: c.card_id, zone: 'main' as const, copies: c.copies }));
}
async function loadStarters(db: Db, deckId: Uuid): Promise<Set<number>> {
  return new Set((await db.q<{ card_id: number }>('select card_id from deck_starters where deck_id = $1', [deckId])).map((r) => r.card_id));
}
async function loadLibrary(db: Db, owner: Uuid, v2: boolean): Promise<Library> {
  const lib: Library = { hopt: new Set(), profiles: new Map(), groups: [], categories: [], cardCategories: new Map() };
  const flagCols = v2 ? 'card_id, is_hopt, availability, group_id' : 'card_id, is_hopt, null::text as availability, null::uuid as group_id';
  for (const f of await db.q<{ card_id: number; is_hopt: boolean; availability: Availability | null; group_id: Uuid | null }>(`select ${flagCols} from card_flags where owner_id = $1`, [owner])) {
    if (f.is_hopt) lib.hopt.add(f.card_id);
    if (f.availability) lib.profiles.set(f.card_id, { availability: f.availability, groupId: f.group_id });
  }
  lib.categories = await db.q<Category>('select id, name, is_builtin from nonengine_categories where owner_id = $1 order by is_builtin desc, name, id', [owner]);
  for (const m of await db.q<{ card_id: number; category_id: Uuid }>('select cc.card_id, cc.category_id from card_categories cc join nonengine_categories c on c.id = cc.category_id where c.owner_id = $1', [owner])) {
    if (!lib.cardCategories.has(m.card_id)) lib.cardCategories.set(m.card_id, new Set());
    lib.cardCategories.get(m.card_id)!.add(m.category_id);
  }
  if (v2) lib.groups = await db.q<NonEngineGroup>('select id, name, cap_per_turn from nonengine_groups where owner_id = $1 order by name', [owner]);
  return lib;
}
/** État v2 d'un deck (base migrée : deck_combo_pairs, deck_conditions, deck_flags). */
async function loadV2State(db: Db, deckId: Uuid): Promise<DeckState> {
  const pairRows = await db.q<{ id: Uuid; card_a_id: number; card_b_id: number; note: string | null; disabled: boolean }>('select id, card_a_id, card_b_id, note, disabled from deck_combo_pairs where deck_id = $1 order by card_a_id, card_b_id', [deckId]);
  const conditions = await db.q<{ id: Uuid; source_card_id: number | null; source_pair_id: Uuid | null; condition: ConditionNode }>('select id, source_card_id, source_pair_id, condition from deck_conditions where deck_id = $1 order by id', [deckId]);
  const flags = await db.q<{ card_id: number; dead_first: boolean; dead_second: boolean }>('select card_id, dead_first, dead_second from deck_flags where deck_id = $1', [deckId]);
  return {
    main: await loadMain(db, deckId), starters: await loadStarters(db, deckId),
    pairs: pairRows.map((p) => ({ id: p.id, card_a_id: p.card_a_id, card_b_id: p.card_b_id, note: p.note })),
    pairExclusions: new Set(pairRows.filter((p) => p.disabled).map((p) => p.id)),
    startConditions: conditions.map((c) => ({ id: c.id, sourceCardId: c.source_card_id, sourcePairId: c.source_pair_id, condition: c.condition })),
    deadFirst: new Set(flags.filter((f) => f.dead_first).map((f) => f.card_id)),
    deadSecond: new Set(flags.filter((f) => f.dead_second).map((f) => f.card_id)),
  };
}
/** Modèle historique d'un deck (base pré-001), comme l'ancienne app le lisait. */
async function loadLegacyModel(db: Db, deck: DeckRow): Promise<LegacyModel> {
  const pairs = (await db.q<LegacyPair>('select id, owner_id, card_a_id, card_b_id, note from combo_pairs where owner_id = $1 order by card_a_id, card_b_id, id', [deck.owner_id]))
    .filter((p) => p.card_a_id !== p.card_b_id);
  const pairExclusions = new Set((await db.q<{ pair_id: Uuid }>('select pair_id from deck_pair_exclusions where deck_id = $1', [deck.id])).map((r) => r.pair_id));
  const requirements = await db.q<LegacyRequirement>('select id, source_card_id, source_pair_id, required_card_id, min_in_deck from deck_start_requirements where deck_id = $1 order by id', [deck.id]);
  const flags = await db.q<{ card_id: number; is_hopt: boolean; dead_first: boolean; dead_second: boolean }>('select card_id, is_hopt, dead_first, dead_second from card_flags where owner_id = $1', [deck.owner_id]);
  const categories = await db.q<{ id: string; name: string; relevance: string; is_builtin: boolean }>('select id, name, relevance, is_builtin from nonengine_categories where owner_id = $1 order by is_builtin desc, name, id', [deck.owner_id]);
  const cardCategories = new Map<number, Set<string>>();
  for (const m of await db.q<{ card_id: number; category_id: Uuid }>('select cc.card_id, cc.category_id from card_categories cc join nonengine_categories c on c.id = cc.category_id where c.owner_id = $1', [deck.owner_id])) {
    if (!cardCategories.has(m.card_id)) cardCategories.set(m.card_id, new Set());
    cardCategories.get(m.card_id)!.add(m.category_id);
  }
  const horizon = (key: string, fallback: number): number => { const v = Number(deck.params?.[key]); return Number.isFinite(v) ? v : fallback; };
  return {
    main: await loadMain(db, deck.id), starters: await loadStarters(db, deck.id), pairs, pairExclusions, requirements,
    hopt: new Set(flags.filter((f) => f.is_hopt).map((f) => f.card_id)),
    deadFirst: new Set(flags.filter((f) => f.dead_first).map((f) => f.card_id)),
    deadSecond: new Set(flags.filter((f) => f.dead_second).map((f) => f.card_id)),
    categories, cardCategories,
    horizonFirst: horizon('horizonFirst', 1), horizonSecond: horizon('horizonSecond', 2),
  };
}

// ─── Modèles et calculs ───
/** Paires globales actives sur ce deck : non exclues, deux cartes dans le main. */
function activeLegacyPairs(legacy: LegacyModel): LegacyPair[] {
  const mainIds = new Set(legacy.main.map((c) => c.cardId));
  return legacy.pairs.filter((p) => !legacy.pairExclusions.has(p.id) && mainIds.has(p.card_a_id) && mainIds.has(p.card_b_id));
}
/** Modèle v2 + paires globales données et leurs prérequis (groupe ET par paire, règle de 002). */
function withReinjectedPairs(state: DeckState, pairs: LegacyPair[], requirements: LegacyRequirement[]): DeckState {
  const ids = new Set(pairs.map((p) => p.id));
  const byPair = new Map<Uuid, LegacyRequirement[]>();
  for (const r of requirements) {
    if (r.source_pair_id === null || !ids.has(r.source_pair_id)) continue;
    if (!byPair.has(r.source_pair_id)) byPair.set(r.source_pair_id, []);
    byPair.get(r.source_pair_id)!.push(r);
  }
  const extra: StartCondition[] = [...byPair.entries()].map(([pairId, group]) => ({ id: group[0].id, sourceCardId: null, sourcePairId: pairId, condition: andOf(group) }));
  return {
    ...state,
    pairs: [...state.pairs, ...pairs.map((p) => ({ id: p.id, card_a_id: p.card_a_id, card_b_id: p.card_b_id, note: p.note }))],
    startConditions: [...state.startConditions, ...extra],
  };
}
interface BrickResult { brick: number | null; reason?: string }
/** Nouveau moteur, passe premier, sur un état v2 et la bibliothèque du compte. */
function newBrick(state: DeckState, lib: Library): BrickResult {
  const source: EngineModelSource = {
    main: state.main, hopt: lib.hopt, profiles: lib.profiles, groups: lib.groups, categories: lib.categories, cardCategories: lib.cardCategories,
    deadFirst: state.deadFirst, deadSecond: state.deadSecond, pairs: state.pairs, starters: state.starters, pairExclusions: state.pairExclusions, startConditions: state.startConditions,
  };
  try {
    const pass = computePass(buildEngineModel(source).input, 'first');
    return pass.unavailableReason ? { brick: null, reason: pass.unavailableReason } : { brick: pass.brick };
  } catch (err) { return { brick: null, reason: err instanceof Error ? err.message : String(err) }; }
}
/** Nouveau moteur sur le modèle historique (--fabricate) : conditions ET par source depuis les prérequis. */
function legacyAsV2State(legacy: LegacyModel): { state: DeckState; lib: Library } {
  const bySource = new Map<string, LegacyRequirement[]>();
  for (const r of legacy.requirements) {
    const key = r.source_card_id !== null ? `c:${r.source_card_id}` : `p:${r.source_pair_id}`;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(r);
  }
  const startConditions: StartCondition[] = [...bySource.values()].map((group) => ({ id: group[0].id, sourceCardId: group[0].source_card_id, sourcePairId: group[0].source_pair_id, condition: andOf(group) }));
  return {
    state: {
      main: legacy.main, starters: legacy.starters, pairExclusions: legacy.pairExclusions, startConditions,
      pairs: legacy.pairs.map((p) => ({ id: p.id, card_a_id: p.card_a_id, card_b_id: p.card_b_id, note: p.note })),
      deadFirst: legacy.deadFirst, deadSecond: legacy.deadSecond,
    },
    lib: { hopt: legacy.hopt, profiles: new Map(), groups: [], categories: legacy.categories.map((c) => ({ id: c.id, name: c.name, is_builtin: c.is_builtin })), cardCategories: legacy.cardCategories },
  };
}
/** Ancien moteur (référence) sur le modèle historique, passe premier (5 cartes). */
function referenceBrick(engine: ReferenceEngine, legacy: LegacyModel): BrickResult {
  try {
    const model = engine.buildEngineModel({
      main: legacy.main, hopt: legacy.hopt, deadFirst: legacy.deadFirst, deadSecond: legacy.deadSecond,
      pairs: legacy.pairs.map((p) => ({ id: p.id, card_a_id: p.card_a_id, card_b_id: p.card_b_id, note: p.note })),
      categories: legacy.categories, cardCategories: legacy.cardCategories, starters: legacy.starters, pairExclusions: legacy.pairExclusions,
      startRequirements: legacy.requirements.map((r) => ({ id: r.id, sourceCardId: r.source_card_id, sourcePairId: r.source_pair_id, requiredCardId: r.required_card_id, minInDeck: r.min_in_deck })),
      horizonFirst: legacy.horizonFirst, horizonSecond: legacy.horizonSecond,
    });
    return { brick: engine.computePass(model.input, 5).brick };
  } catch (err) { return { brick: null, reason: err instanceof Error ? err.message : String(err) }; }
}

/** Matérialise l'ancien moteur depuis l'historique git (aucune copie versionnée) et le charge. */
async function loadReferenceEngine(dir: string): Promise<ReferenceEngine> {
  const git = (...a: string[]): string => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = git('ls-tree', '--name-only', REFERENCE_COMMIT, 'web/src/engine/').split(/\r?\n/).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  files.push('web/src/lib/engineModel.ts', 'web/src/types.ts');
  for (const f of files) {
    const target = join(dir, f.replace(/^web\/src\//, ''));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git('show', `${REFERENCE_COMMIT}:${f}`), 'utf8');
  }
  writeFileSync(join(dir, 'package.json'), '{ "type": "module", "private": true, "description": "Ancien moteur ' + REFERENCE_COMMIT + ', matérialisé par scripts/recompute-check.ts — ne pas modifier." }\n', 'utf8');
  const engine = await import(pathToFileURL(join(dir, 'engine', 'index.ts')).href) as { computePass: ReferenceEngine['computePass'] };
  const model = await import(pathToFileURL(join(dir, 'lib', 'engineModel.ts')).href) as { buildEngineModel: ReferenceEngine['buildEngineModel'] };
  if (typeof engine.computePass !== 'function' || typeof model.buildEngineModel !== 'function') usage(`ancien moteur incomplet dans ${dir}`);
  return { computePass: engine.computePass, buildEngineModel: model.buildEngineModel };
}

// ─── --fabricate : résumés du jeu représentatif, comme l'ancienne app les enregistrait ───
const newDb = new Db(newUrl);
await newDb.connect();
if (fabricate) {
  if (await newDb.regclass('app_migrations')) usage('--fabricate : base PRÉ-001 attendue (app_migrations existe déjà)');
  for (const t of ['combo_pairs', 'deck_pair_exclusions', 'deck_start_requirements']) if (!(await newDb.regclass(t))) usage(`--fabricate : table historique ${t} absente`);
  const lines: string[] = [];
  for (const deck of await newDb.q<DeckRow>('select id, owner_id, name, params, summary from decks order by name, id')) {
    const legacy = await loadLegacyModel(newDb, deck);
    const { state, lib } = legacyAsV2State(legacy);
    const r = newBrick(state, lib);
    if (r.brick === null) usage(`--fabricate : ${deck.name} (${deck.id}) — passe premier indisponible : ${r.reason}`);
    const summary = { mainSize: mainSizeOf(legacy.main), brickRate: r.brick, startRateFirst: 1 - r.brick };
    await newDb.q('update decks set summary = $2::jsonb where id = $1', [deck.id, JSON.stringify(summary)]);
    lines.push(`${deck.id}  ${deck.name}: mainSize ${summary.mainSize}, brickRate ${fmt(summary.brickRate)}, startRateFirst ${fmt(summary.startRateFirst)} (paires globales actives : ${activeLegacyPairs(legacy).length}, prérequis source paire : ${legacy.requirements.filter((r) => r.source_pair_id).length})`);
  }
  await newDb.end();
  console.log(`résumés d'avant purge fabriqués par le moteur (modèle historique) pour ${lines.length} deck(s) :`);
  for (const l of lines) console.log(`  ${l}`);
  process.exit(0);
}

// ─── Contrôle ───
const oldDb = new Db(oldUrl!);
await oldDb.connect();
if (!(await newDb.journaled('003-purge-legacy'))) usage('--db : 003-purge-legacy non journalisée, le contrôle porte sur une base migrée');
if (await oldDb.regclass('app_migrations')) usage('--old-db : base PRÉ-MIGRATION attendue (aucun journal app_migrations)');
for (const t of ['combo_pairs', 'deck_pair_exclusions', 'deck_start_requirements']) if (!(await oldDb.regclass(t))) usage(`--old-db : table historique ${t} absente`);
const engine = await loadReferenceEngine(referenceDir);
const newDecks = await newDb.q<DeckRow>('select id, owner_id, name, params, summary from decks order by name, id');
const oldDecks = new Map((await oldDb.q<DeckRow>('select id, owner_id, name, params, summary from decks')).map((d) => [d.id, d]));
const libs = new Map<Uuid, Library>();
const out: string[] = [];
const say = (s: string): void => { out.push(s); };
let failures = 0, compared = 0, identical = 0, attributed = 0;
say(`Contrôle de recalcul après 003 — ${newDecks.length} deck(s) dans la base migrée, ${oldDecks.size} dans la base pré-migration ; tolérance ${tolerance}.`);
say(`Référence : ancien moteur ${REFERENCE_COMMIT} (production) sur le modèle historique de la base pré-migration, passe premier (5 cartes) ; (a) nouveau moteur avec paires globales réinjectées, attendu identique ; (b) nouveau moteur après purge, écart attribué et chiffré. Résumé stocké : informatif seulement (cache de la dernière sauvegarde, possiblement périmé).`);
say('');
for (const deck of newDecks) {
  const label = `${deck.name} (${deck.id})`;
  const oldDeck = oldDecks.get(deck.id);
  if (!oldDeck) { say(`✗ ${label} : absent de la base pré-migration`); failures++; continue; }
  if (!libs.has(deck.owner_id)) libs.set(deck.owner_id, await loadLibrary(newDb, deck.owner_id, true));
  const lib = libs.get(deck.owner_id)!;
  const legacy = await loadLegacyModel(oldDb, oldDeck);
  const state = await loadV2State(newDb, deck.id);
  compared++;
  const reference = referenceBrick(engine, legacy);
  const active = activeLegacyPairs(legacy);
  const pairReqs = legacy.requirements.filter((r) => r.source_pair_id !== null && active.some((p) => p.id === r.source_pair_id));
  const equiv = newBrick(withReinjectedPairs(state, active, legacy.requirements), lib);
  const purged = newBrick(state, lib);
  const stored = oldDeck.summary;
  const storedNote = typeof stored?.brickRate === 'number'
    ? `résumé stocké (possiblement périmé) brick ${fmt(stored.brickRate)}${reference.brick !== null ? ` (${fmtDelta(stored.brickRate - reference.brick)} vs référence)` : ''}`
    : 'résumé stocké absent';
  const problems: string[] = [];
  const mainNew = mainSizeOf(state.main), mainOld = mainSizeOf(legacy.main);
  if (mainNew !== mainOld) problems.push(`mainSize ${mainNew} ≠ ${mainOld} avant migration`);
  if (reference.brick === null) problems.push(`référence indisponible : ${reference.reason}`);
  if (equiv.brick === null) problems.push(`(a) indisponible : ${equiv.reason}`);
  if (purged.brick === null) problems.push(`(b) indisponible : ${purged.reason}`);
  const what = active.length || pairReqs.length
    ? `${active.length} paire(s) globale(s) active(s) purgée(s) [${active.map(pairLabel).join(', ')}]${pairReqs.length ? `, ${pairReqs.length} prérequis source paire purgé(s)` : ''}`
    : 'aucune paire globale active ni prérequis source paire';
  if (reference.brick !== null && equiv.brick !== null && Math.abs(equiv.brick - reference.brick) > tolerance) {
    problems.push(`ÉCART NON EXPLIQUÉ en (a) : nouveau moteur avec paires réinjectées ${fmt(equiv.brick)} ≠ référence ${fmt(reference.brick)} (${fmtDelta(equiv.brick - reference.brick)})`);
  }
  if (reference.brick !== null && purged.brick !== null && active.length === 0 && pairReqs.length === 0 && Math.abs(purged.brick - reference.brick) > tolerance) {
    problems.push(`ÉCART NON EXPLIQUÉ en (b) : aucune paire purgée mais brick après purge ${fmt(purged.brick)} ≠ référence ${fmt(reference.brick)}`);
  }
  if (problems.length) {
    failures++;
    say(`✗ ${label} : ${problems.join(' ; ')} — mainSize ${mainNew} · ${what} · ${storedNote}`);
    continue;
  }
  const d = purged.brick! - reference.brick!;
  if (active.length === 0 && pairReqs.length === 0) {
    identical++;
    say(`✓ ${label} : identique — mainSize ${mainNew} · référence ${fmt(reference.brick)} · (a) ${fmt(equiv.brick)} (${fmtDelta(equiv.brick! - reference.brick!)}) · (b) après purge ${fmt(purged.brick)} (${fmtDelta(d)}) · ${storedNote}`);
  } else {
    attributed++;
    say(`✓ ${label} : (a) identique, écart après purge attribué — mainSize ${mainNew} · référence ${fmt(reference.brick)} · (a) ${fmt(equiv.brick)} (${fmtDelta(equiv.brick! - reference.brick!)}) · (b) après purge ${fmt(purged.brick)} : Δbrick ${fmtDelta(d)} (${(d * 100).toFixed(4)} points) dû à ${what} · ${storedNote}`);
  }
}
say('');
say(`Bilan : ${compared} deck(s) comparé(s) — ${identical} identique(s) sans paire purgée, ${attributed} deck(s) à écart attribué aux paires purgées avec (a) identique, ${failures} en échec.`);
say(failures === 0 ? 'RECALCUL CONFORME' : 'RECALCUL NON CONFORME (écart non expliqué : à lister en question ouverte)');
await newDb.end();
await oldDb.end();
const text = out.join('\n') + '\n';
process.stdout.write(text);
if (outFile) writeFileSync(outFile, text, 'utf8');
process.exit(failures === 0 ? 0 : 1);
