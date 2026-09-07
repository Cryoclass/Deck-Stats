/** Pure boundary contract shared with the web client; no server/framework imports. */
export interface Configuration {
  version: 2;
  name: string;
  cards: Array<{ card_id: number; zone: 'main' | 'extra' | 'side'; copies: number }>;
  starters: number[];
  pairs: Array<{ id: string; card_a_id: number; card_b_id: number; note?: string | null; disabled: boolean }>;
  requirements: Array<{ id: string; source_card_id: number | null; source_pair_id: string | null; required_card_id: number; min_in_deck: number }>;
  deadFirst: number[];
  deadSecond: number[];
  params: Record<string, unknown>;
  notes: string | null;
}

export class ConfigurationError extends Error { readonly statusCode = 400; }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cardIdValid = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
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

/** Query category references are validated/remapped by the library boundary. */
export function validateParams(value: unknown): asserts value is Record<string, unknown> {
  requireThat(record(value), 'Paramètres invalides.');
  const allowed = ['horizonFirst', 'horizonSecond', 'importance', 'statsView', 'savedQueries'];
  requireThat(Object.keys(value).every((key) => allowed.includes(key)), 'Paramètre non pris en charge.');
  for (const key of ['horizonFirst', 'horizonSecond']) {
    const v = value[key];
    requireThat(v === undefined || (Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 3), 'Horizon invalide.');
  }
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
  knownKeys(value,['version','name','cards','starters','pairs','requirements','deadFirst','deadSecond','params','notes']);
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
  requireThat(Array.isArray(value.requirements), 'Conditions requises.');
  const requirementIds = new Set<string>();
  for (const r of value.requirements) {
    requireThat(record(r) && typeof r.id === 'string' && uuidPattern.test(r.id) && cardIdValid(r.required_card_id) && Number.isInteger(r.min_in_deck) && Number(r.min_in_deck) >= 1 && Number(r.min_in_deck) <= 32767, 'Condition invalide.');
    const card = cardIdValid(r.source_card_id) && r.source_pair_id === null;
    knownKeys(r,['id','source_card_id','source_pair_id','required_card_id','min_in_deck']);
    const pair = r.source_card_id === null && typeof r.source_pair_id === 'string' && pairIds.has(r.source_pair_id);
    requireThat(card || pair, 'Une condition doit référencer une carte ou une paire de ce deck.');
    requireThat(!requirementIds.has(r.id), 'Identifiant de condition dupliqué.');
    requirementIds.add(r.id);
  }
  validateParams(value.params);
  requireThat(value.notes === null || typeof value.notes === 'string', 'Notes invalides.');
  // Detach the validated document from caller-owned mutable objects.
  return { ...structuredClone(value), name: value.name.trim() } as unknown as Configuration;
}

export function emptyConfiguration(name: string, cards: Configuration['cards'] = []): Configuration {
  return { version: 2, name, cards, starters: [], pairs: [], requirements: [], deadFirst: [], deadSecond: [], params: {}, notes: null };
}
