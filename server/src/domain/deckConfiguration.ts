/** Pure boundary contract shared with the web client; no server/framework imports. */

/** Profil de disponibilité non-engine (contrat §3), annotation manuelle du compte. */
export const AVAILABILITY_PROFILES = ['early', 'flexible', 'prepared', 'breaker'] as const;
export type Availability = (typeof AVAILABILITY_PROFILES)[number];

/**
 * Condition ET/OU d'une source de start (contrat §4), sur le deck restant après le
 * tirage observé. Feuille : « il reste au moins `at_least` copies de `card_id` dans le
 * main deck ». Un groupe vide est une configuration incomplète : refusée, jamais vraie.
 */
export type ConditionNode =
  | { kind: 'remaining'; card_id: number; at_least: number }
  | { kind: 'and'; all: ConditionNode[] }
  | { kind: 'or'; any: ConditionNode[] };

export interface StartCondition {
  id: string;
  source_card_id: number | null;
  source_pair_id: string | null;
  condition: ConditionNode;
}

export interface Configuration {
  version: 2;
  name: string;
  cards: Array<{ card_id: number; zone: 'main' | 'extra' | 'side'; copies: number }>;
  starters: number[];
  pairs: Array<{ id: string; card_a_id: number; card_b_id: number; note?: string | null; disabled: boolean }>;
  /** Une condition au plus par source (starter ou paire de ce deck). */
  conditions: StartCondition[];
  deadFirst: number[];
  deadSecond: number[];
  params: Record<string, unknown>;
  notes: string | null;
}

export class ConfigurationError extends Error { readonly statusCode = 400; }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cardIdValid = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
export const availabilityValid = (v: unknown): v is Availability => typeof v === 'string' && (AVAILABILITY_PROFILES as readonly string[]).includes(v);
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new ConfigurationError(message);
}
function knownKeys(value: Record<string,unknown>, allowed: string[]): void {
  requireThat(Object.keys(value).every((key) => allowed.includes(key)), 'Champ de configuration non pris en charge.');
}
function ids(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(cardIdValid) && new Set(value).size === value.length;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Profondeur maximale d'un arbre de condition : borne de représentation, pas une règle métier. */
export const CONDITION_MAX_DEPTH = 8;
export const CONDITION_MAX_LEAVES = 64;

/** Valide un arbre de condition : opérateur connu, groupes non vides, quantités entières ≥ 1. */
export function validateCondition(value: unknown, depth = 0, budget = { leaves: 0 }): asserts value is ConditionNode {
  requireThat(record(value), 'Condition invalide : opérateur inconnu.');
  requireThat(depth < CONDITION_MAX_DEPTH, 'Condition trop profonde.');
  switch (value.kind) {
    case 'remaining':
      knownKeys(value,['kind','card_id','at_least']);
      requireThat(cardIdValid(value.card_id), 'Condition invalide : carte requise invalide.');
      requireThat(Number.isInteger(value.at_least) && Number(value.at_least) >= 1 && Number(value.at_least) <= 32767, 'Condition invalide : quantité entière ≥ 1 attendue.');
      budget.leaves += 1;
      requireThat(budget.leaves <= CONDITION_MAX_LEAVES, 'Condition trop longue.');
      return;
    case 'and':
    case 'or': {
      knownKeys(value,['kind', value.kind === 'and' ? 'all' : 'any']);
      const children = value.kind === 'and' ? value.all : value.any;
      requireThat(Array.isArray(children) && children.length > 0, 'Condition incomplète : un groupe ET/OU est vide.');
      for (const child of children as unknown[]) validateCondition(child, depth + 1, budget);
      return;
    }
    default:
      throw new ConfigurationError('Condition invalide : opérateur inconnu.');
  }
}

/** Query category references are validated/remapped by the library boundary. */
export function validateParams(value: unknown): asserts value is Record<string, unknown> {
  requireThat(record(value), 'Paramètres invalides.');
  const allowed = ['importance', 'statsView', 'savedQueries'];
  requireThat(Object.keys(value).every((key) => allowed.includes(key)), 'Paramètre non pris en charge.');
  requireThat(value.importance === undefined || (typeof value.importance === 'number' && Number.isFinite(value.importance) && value.importance >= 0 && value.importance <= 1), 'Importance invalide.');
  requireThat(value.statsView === undefined || typeof value.statsView === 'string', 'Vue invalide.');
  if (value.savedQueries === undefined) return;
  requireThat(Array.isArray(value.savedQueries), 'Requêtes invalides.');
  for (const q of value.savedQueries) {
    requireThat(record(q) && typeof q.id === 'string' && typeof q.name === 'string' && Array.isArray(q.criteria), 'Requête invalide.');
    for (const criterion of q.criteria) {
      requireThat(record(criterion) && typeof criterion.id === 'string' && record(criterion.subject), 'Critère invalide.');
      for (const bound of [criterion.min, criterion.max]) requireThat(bound === null || (Number.isSafeInteger(bound) && Number(bound) >= 0), 'Borne invalide.');
      requireThat(criterion.min === null || criterion.max === null || Number(criterion.min) <= Number(criterion.max), 'Intervalle inversé.');
      const s = criterion.subject;
      requireThat(['starts', 'redundancy', 'nonengine', 'category', 'group'].includes(String(s.kind)), 'Sujet non pris en charge.');
      if (s.kind === 'category') requireThat(typeof s.categoryId === 'string', 'Catégorie requise.');
      if (s.kind === 'group') requireThat(strings(s.categoryIds), 'Groupe invalide.');
    }
  }
}

export function parseConfiguration(value: unknown): Configuration {
  requireThat(record(value) && value.version === 2, 'Configuration version 2 requise.');
  requireThat(!('requirements' in value), 'Conditions de start au format antérieur (prérequis ET). Rechargez l’application ; un export JSON antérieur est converti à l’import.');
  knownKeys(value,['version','name','cards','starters','pairs','conditions','deadFirst','deadSecond','params','notes']);
  requireThat(typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 200, 'Nom requis (200 caractères maximum).');
  requireThat(Array.isArray(value.cards), 'Cartes requises.');
  const seenCards = new Set<string>();
  for (const c of value.cards) {
    requireThat(record(c) && cardIdValid(c.card_id) && ['main', 'extra', 'side'].includes(String(c.zone)) && Number.isInteger(c.copies) && Number(c.copies) >= 1 && Number(c.copies) <= 3, 'Carte, zone ou quantité invalide.');
    const key = `${c.zone}:${c.card_id}`;
    knownKeys(c,['card_id','zone','copies']);
    requireThat(!seenCards.has(key), 'Carte dupliquée dans une zone : regrouper les exemplaires.');
    seenCards.add(key);
  }
  requireThat(ids(value.starters) && ids(value.deadFirst) && ids(value.deadSecond), 'Annotations de carte invalides.');
  requireThat(Array.isArray(value.pairs), 'Paires requises.');
  const pairIds = new Set<string>();
  const pairKeys = new Set<string>();
  for (const p of value.pairs) {
    requireThat(record(p) && typeof p.id === 'string' && uuidPattern.test(p.id) && cardIdValid(p.card_a_id) && cardIdValid(p.card_b_id) && p.card_a_id < p.card_b_id && typeof p.disabled === 'boolean' && (p.note == null || typeof p.note === 'string'), 'Paire invalide : ordre canonique A < B requis.');
    const key = `${p.card_a_id}:${p.card_b_id}`;
    knownKeys(p,['id','card_a_id','card_b_id','note','disabled']);
    requireThat(!pairIds.has(p.id) && !pairKeys.has(key), 'Paire dupliquée.');
    pairIds.add(p.id); pairKeys.add(key);
  }
  requireThat(Array.isArray(value.conditions), 'Conditions requises.');
  const conditionIds = new Set<string>();
  const sources = new Set<string>();
  for (const r of value.conditions) {
    requireThat(record(r) && typeof r.id === 'string' && uuidPattern.test(r.id), 'Condition invalide.');
    knownKeys(r,['id','source_card_id','source_pair_id','condition']);
    const card = cardIdValid(r.source_card_id) && r.source_pair_id === null;
    const pair = r.source_card_id === null && typeof r.source_pair_id === 'string' && pairIds.has(r.source_pair_id);
    requireThat(card || pair, 'Une condition doit référencer une carte ou une paire de ce deck.');
    const source = card ? `c:${r.source_card_id}` : `p:${r.source_pair_id}`;
    requireThat(!sources.has(source), 'Une source de start porte une seule condition (composer avec ET/OU).');
    sources.add(source);
    validateCondition(r.condition);
    requireThat(!conditionIds.has(r.id), 'Identifiant de condition dupliqué.');
    conditionIds.add(r.id);
  }
  validateParams(value.params);
  requireThat(value.notes === null || typeof value.notes === 'string', 'Notes invalides.');
  // Detach the validated document from caller-owned mutable objects.
  return { ...structuredClone(value), name: value.name.trim() } as unknown as Configuration;
}

/**
 * Conversion EXPLICITE d'un document antérieur à l'étape 5B (prérequis ET plats
 * `requirements`, horizons dans `params`) vers la représentation unique : chaque source
 * reçoit un groupe ET de feuilles, dans l'ordre des identifiants — la règle exacte de
 * la migration SQL 002. Réservée aux archives JSON et brouillons ; l'API refuse
 * l'ancien format (un client périmé doit recharger). Un document déjà à jour est rendu
 * tel quel ; la validation complète reste à `parseConfiguration`.
 */
export function upgradeConfiguration(value: unknown): unknown {
  if (!record(value) || value.version !== 2) return value;
  const out: Record<string, unknown> = { ...value };
  if (record(out.params)) {
    const { horizonFirst: _f, horizonSecond: _s, ...rest } = out.params;
    out.params = rest;
  }
  if (!('requirements' in out) || 'conditions' in out) return out;
  const { requirements, ...rest } = out;
  const bySource = new Map<string, { source_card_id: number | null; source_pair_id: string | null; leaves: ConditionNode[]; ids: string[] }>();
  if (Array.isArray(requirements)) {
    const rows = [...requirements].filter(record).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const r of rows) {
      const key = r.source_card_id != null ? `c:${r.source_card_id}` : `p:${r.source_pair_id}`;
      const entry = bySource.get(key) ?? { source_card_id: (r.source_card_id as number | null) ?? null, source_pair_id: (r.source_pair_id as string | null) ?? null, leaves: [], ids: [] };
      entry.leaves.push({ kind: 'remaining', card_id: r.required_card_id as number, at_least: r.min_in_deck as number });
      entry.ids.push(String(r.id));
      bySource.set(key, entry);
    }
  }
  return { ...rest, conditions: [...bySource.values()].map((e) => ({ id: e.ids[0], source_card_id: e.source_card_id, source_pair_id: e.source_pair_id, condition: { kind: 'and', all: e.leaves } })) };
}

export function emptyConfiguration(name: string, cards: Configuration['cards'] = []): Configuration {
  return { version: 2, name, cards, starters: [], pairs: [], conditions: [], deadFirst: [], deadSecond: [], params: {}, notes: null };
}
