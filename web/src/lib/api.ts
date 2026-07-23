import type { Card, Library, Relevance, Zone } from '../types.js';

const BASE = '/api';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  // Ne déclarer le content-type JSON QUE s'il y a un corps : sinon Fastify rejette une
  // requête sans corps (DELETE, POST duplicate…) avec FST_ERR_CTP_EMPTY_JSON_BODY (400).
  const hasBody = init?.body != null;
  const res = await fetch(BASE + url, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface DeckSummaryStats {
  startRateFirst?: number;
  brickRate?: number;
  mainSize?: number;
}
export interface DeckSummary {
  id: string;
  name: string;
  main_count: number;
  updated_at: string;
  summary: DeckSummaryStats | null;
  sample_cards: Array<number | string> | null;
}
export interface DeckRequirementRow {
  id: string;
  source_card_id: number | null;
  source_pair_id: string | null;
  required_card_id: number;
  min_in_deck: number;
}
export interface DeckDetail {
  id: string;
  name: string;
  cards: Array<{ card_id: number; zone: Zone; copies: number }>;
  starters: number[];
  pair_exclusions: string[];
  start_requirements?: DeckRequirementRow[];
  params?: Record<string, unknown> | null;
  summary?: DeckSummaryStats | null;
  notes?: string | null;
  updated_at?: string;
}

export const api = {
  health: () => j<{ ok: boolean; cards: number }>('/health'),

  // Catalogue
  cardsByIds: (ids: number[]) =>
    ids.length ? j<Card[]>(`/cards?ids=${ids.join(',')}`) : Promise.resolve([]),
  searchCards: (q: string) => j<Card[]>(`/cards/search?q=${encodeURIComponent(q)}`),

  // Decks
  listDecks: () => j<DeckSummary[]>('/decks'),
  getDeck: (id: string) => j<DeckDetail>(`/decks/${id}`),
  createDeck: (name: string, cards: DeckDetail['cards']) =>
    j<{ id: string }>('/decks', { method: 'POST', body: JSON.stringify({ name, cards }) }),
  updateDeck: (
    id: string,
    patch: {
      name?: string;
      cards?: DeckDetail['cards'];
      params?: unknown;
      summary?: DeckSummaryStats;
      notes?: string | null;
    },
  ) => j<{ ok: boolean }>(`/decks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  duplicateDeck: (id: string) =>
    j<{ id: string }>(`/decks/${id}/duplicate`, { method: 'POST' }),
  deleteDeck: (id: string) => j<{ ok: boolean }>(`/decks/${id}`, { method: 'DELETE' }),
  setStarters: (id: string, cardIds: number[]) =>
    j(`/decks/${id}/starters`, { method: 'PUT', body: JSON.stringify({ cardIds }) }),
  setPairExclusions: (id: string, pairIds: string[]) =>
    j(`/decks/${id}/pair-exclusions`, { method: 'PUT', body: JSON.stringify({ pairIds }) }),
  setStartRequirements: (
    id: string,
    requirements: Array<{
      source_card_id?: number | null;
      source_pair_id?: string | null;
      required_card_id: number;
      min_in_deck?: number;
    }>,
  ) =>
    j(`/decks/${id}/start-requirements`, {
      method: 'PUT',
      body: JSON.stringify({ requirements }),
    }),

  // Bibliothèque globale
  getLibrary: () => j<Library>('/library'),
  setFlags: (
    cardId: number,
    flags: { is_hopt?: boolean; dead_first?: boolean; dead_second?: boolean },
  ) => j(`/library/flags/${cardId}`, { method: 'PUT', body: JSON.stringify(flags) }),
  addPair: (a: number, b: number, note?: string) =>
    j<{ id: string; card_a_id: number; card_b_id: number; note: string | null }>('/library/pairs', {
      method: 'POST',
      body: JSON.stringify({ card_a_id: a, card_b_id: b, note }),
    }),
  deletePair: (id: string) => j(`/library/pairs/${id}`, { method: 'DELETE' }),
  addCategory: (name: string, relevance: Relevance) =>
    j<{ id: string; name: string; relevance: Relevance; is_builtin: boolean }>(
      '/library/categories',
      { method: 'POST', body: JSON.stringify({ name, relevance }) },
    ),
  deleteCategory: (id: string) => j(`/library/categories/${id}`, { method: 'DELETE' }),
  addCardCategory: (cardId: number, categoryId: string) =>
    j('/library/card-categories', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, category_id: categoryId }),
    }),
  removeCardCategory: (cardId: number, categoryId: string) =>
    j(`/library/card-categories/${cardId}/${categoryId}`, { method: 'DELETE' }),
};
